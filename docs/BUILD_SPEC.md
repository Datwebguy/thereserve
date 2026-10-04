# The Reserve: Build Spec

A scaffold-hbar template for the Hedera Scaffold-HBAR Template Bounty.

**One line:** A token that can't be minted beyond its reserves, and can't be fooled by a bad price.

**Deadline:** Sun 4 Oct 2026, 11:59 PM ET (5 Oct, 03:59 UTC).

---

## 1. What we are building

A template developers start from when they need to issue a token on Hedera that is backed by reserves held on-chain.

- Users lock **HBAR** in The Reserve contract as collateral.
- The contract values that HBAR using **Chainlink's HBAR/USD price feed**.
- It mints a USD-denominated **HTS token** only while the user's collateral stays above a set ratio (default 150%).
- Every price the contract uses goes through a **price guard** that refuses stale, broken or suspicious prices. This is the lesson from the July 2026 Bonzo Lend exploit, where a lender accepted a manipulated oracle update and lost about $9.05M.
- Every mint, burn, rejection and price refusal is written to a **Hedera Consensus Service (HCS) topic**, so anyone can audit it on HashScan.

### Why this template does not exist yet
- The built-in **Oracles** template reads a price and stops. The Reserve uses the price to **control token supply**.
- **QuoteProof** (a public bounty repo) proves which price a quote used. It does not constrain supply.
- **LettermanLabs' lending market** uses prices to value collateral for borrowing. The Reserve is about **issuing** a backed token, with a guard against bad prices built in.

### Why not Chainlink Proof of Reserve
Chainlink announced Proof of Reserve on Hedera in December 2024, but its public feed directory lists **no reserve feeds on Hedera mainnet or testnet**, only price feeds. So The Reserve keeps its reserves on-chain and values them with a price feed that exists. The reserve check sits behind an interface so a real Proof of Reserve feed can be plugged in later (see section 4.4). Say this plainly in the README.

---

## 2. How it scores

| Rubric criterion | Points | How The Reserve earns them |
|---|---|---|
| Ecosystem integration | 35 | Chainlink HBAR/USD is load-bearing: without it the contract cannot know what its reserves are worth, so it cannot decide whether to mint. Optional Pyth cross-check adds a second named protocol. |
| Documentation | 30 | README written as a procedure from `npm create` to a working mint; architecture diagram; env var table; testnet proof links; working `AGENTS.md`. |
| Code quality | 20 | Small contracts, pure logic in libraries, meaningful tests for every rule, clear error codes. |
| Hedera service depth | 15 | HTS with the supply key held by the contract (the contract is the only minter), plus HCS for the audit log, plus Mirror Node for reading history. |

---

## 3. Eligibility gate checklist

Every item must pass or nothing gets judged.

- [ ] Scaffolds with `npm create scaffold-hbar@latest -- --template <owner>/<repo>`
  - Hedera's pages show two forms: `npm create scaffold-hbar@latest -- --template <owner>/<repo>` (the brief, used for the gate) and `npm create scaffold-hbar@latest --template <owner>/<repo>` (the bounty page). The `--` passes `--template` through to the scaffold tool; without it npm may swallow the flag. Test both from a fresh terminal. Document the `--` form as primary, and the short form only if it also works.
- [ ] Valid `template.json`
- [ ] `README.md` and `AGENTS.md` present
- [ ] Install, lint and build pass from a fresh scaffold
- [ ] App boots; core routes return OK
- [ ] At least one Hedera service live, with a testnet transaction linked on HashScan or the mirror node
- [ ] No secrets or `.env` committed (only `.env.example`)
- [ ] MIT licence; original code
- [ ] Monorepo with `packages/`; Next.js; Hardhat; npm or Yarn workspaces; Node 20.18.3+
- [ ] If Hedera Harness is used: its spec and validators included in the submission

**Authorship:** the repository owner is the only author. No AI tool or agent may appear as an author or co-author anywhere: no `Co-Authored-By` lines, no "Generated with" footers in commits or PRs, no AI credits in code, docs or `template.json`. Check `git log` before submitting.

---

## 4. Contracts

Location: `packages/hardhat/contracts/`

### 4.1 `TheReserve.sol` (main contract)

**State**
- `token` — address of the HTS token. Its supply key and treasury are this contract.
- `priceGuard` — address of the PriceGuard contract.
- `minRatioBps` — minimum collateral ratio, default `15000` (150%).
- Per account: `collateral[account]` (HBAR, in tinybars) and `debt[account]` (tokens minted, in token units).
- Totals: `totalCollateral`, `totalDebt`.

**Functions**

| Function | What it does |
|---|---|
| `deposit()` payable | Adds HBAR to the caller's collateral. Emits `Deposited`. |
| `mint(uint256 amount)` | Gets a guarded price. If the price is refused, or if minting would push the caller below `minRatioBps`, **does not revert**: emits `MintRejected(account, amount, reasonCode, price)` and returns `false`. Otherwise mints through the HTS system contract, transfers the tokens to the caller, increases `debt`, emits `Minted`, and returns `true`. |
| `burn(uint256 amount)` | Caller returns tokens (transfer to the treasury, then the contract burns them through HTS). Decreases `debt`. Emits `Burned`. Burning never needs a price, so users can always reduce debt even when prices are refused. |
| `withdraw(uint256 amountTinybars)` | Returns HBAR if the caller stays at or above `minRatioBps` afterwards, using a guarded price. If the price is refused or the ratio would break, emits `WithdrawRejected` and returns `false`. Users with zero debt can always withdraw without a price. |
| `ratioOf(address)` view | Current collateral ratio in basis points, using the last accepted price. |
| `reserveSummary()` view | Total collateral, its USD value, total supply, overall ratio, last accepted price and its age. |

**Why `mint` returns `false` instead of reverting:** a reverted transaction erases its events, so a rejected attempt would leave no trace to log. Returning `false` and emitting `MintRejected` makes every refusal visible on HCS. Document this design choice in the README.

**Reason codes** (shared by events and the UI):

| Code | Meaning |
|---|---|
| `1` | Ratio would fall below minimum |
| `2` | Price stale |
| `3` | Price non-positive or malformed round |
| `4` | Price jumped more than allowed since last accepted price |
| `5` | Secondary source disagrees (if enabled) |
| `6` | Token association missing for receiver |

**Admin**
- Constructor sets the parameters. Prefer **no admin** after deployment. If an admin is kept for the template, it may only change guard parameters within hard-coded bounds, and every change emits an event. Never let an admin mint.

### 4.2 `PriceGuard.sol`

Reads Chainlink's `AggregatorV3Interface.latestRoundData()` and decides whether to trust the price.

**Checks, in order**
1. `answer > 0`
2. `updatedAt != 0` and `answeredInRound >= roundId`
3. **Staleness:** `block.timestamp - updatedAt <= maxStaleness`. Set `maxStaleness` from the feed's documented heartbeat plus a margin.
4. **Jump limit:** if a previous price was accepted, the change is within `maxJumpBps` (default 2,000 = 20%).
5. **Optional second source:** if enabled, the Pyth price is within `maxDivergenceBps` of Chainlink.

**Functions**
- `getGuardedPrice()` — returns `(ok, price, reasonCode)` and, when `ok`, stores it as the last accepted price.
- `evaluate(int256 answer, uint256 updatedAt, uint80 roundId, uint80 answeredInRound)` **pure/view** — runs the same checks on values the caller supplies, with no state change. The UI's "Price guard simulator" uses this. It must be clearly labelled as a simulation, never presented as live data.

**Constructor parameters:** feed address, `maxStaleness`, `maxJumpBps`, optional Pyth address and price ID, `maxDivergenceBps`.

### 4.3 `ReserveMath.sol` (library)

Pure functions so the core math is easy to test without Hedera:
- HBAR (tinybars, 8 decimals) × price (Chainlink HBAR/USD, 8 decimals) → USD value at token decimals
- Collateral ratio in basis points
- Maximum mintable amount for given collateral and price

### 4.4 `IReserveSource.sol` (interface, upgrade path)

A small interface: `reserveValueUsd(address account) returns (uint256)`. The Reserve's on-chain HBAR valuation implements it. A future adapter could implement it using a Chainlink Proof of Reserve feed once one exists on Hedera. Ship the interface and one implementation; document the second as the upgrade path.

### 4.5 Hedera specifics to get right

These are the classic Hedera traps. Each one needs a comment in code and a line in the README.

- **HBAR units:** inside contracts, `msg.value` and balances are in **tinybars (8 decimals)**. The JSON-RPC relay and wallets often show **weibars (18 decimals)**. Convert once, in one place, with tests.
- **Token association:** an account must associate the HTS token before it can receive it, or the transfer fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. The UI must check association first and offer an "Associate token" button. Use the HIP-719 token-facade `associate()` call or an SDK `TokenAssociateTransaction`; verify which the wallet setup supports.
- **Token creation:** create the HTS token in the deploy script with the Hedera SDK (`TokenCreateTransaction`), setting **supply key = The Reserve contract** and **treasury = The Reserve contract**. This is simpler and more reliable than creating it from inside Solidity.
- **HTS system contract:** mint, burn and transfer go through the HTS system contract (address `0x167`). Check every response code.

---

## 5. HCS audit log

Contracts cannot write to HCS directly, so a small service does it.

**`packages/logger`** (Node + TypeScript)
- On start, creates or reuses an HCS topic (topic ID from env).
- Polls the Mirror Node for The Reserve's contract events: `Deposited`, `Minted`, `MintRejected`, `Burned`, `Withdrawn`, `WithdrawRejected`, `PriceRefused`.
- For each event, submits one HCS message:

```json
{
  "v": 1,
  "event": "MintRejected",
  "account": "0.0.x / 0x...",
  "amount": "1000000",
  "reasonCode": 4,
  "price": "<8-decimal price or null>",
  "txHash": "0x...",
  "consensusTimestamp": "...",
  "contract": "0.0.x"
}
```

- **Idempotent:** keeps the last processed timestamp and never logs the same `txHash` twice.
- **Survives restarts:** resumes from the stored timestamp.
- Uses its own operator key from env. Document that this key can only post to the topic, not move funds.

**Cost note:** log state changes only, not page views. One message per contract event.

---

## 6. Frontend

`packages/nextjs` — keep the scaffold-hbar structure and wallet setup.

| Route | Shows |
|---|---|
| `/` | Reserve summary: total HBAR held, its USD value, total supply, overall ratio, the last accepted price and how old it is, guard status (healthy / refusing with reason) |
| `/vault` | The connected user's collateral, debt and ratio. Buttons: Associate token, Deposit, Mint, Burn, Withdraw. Shows the maximum mintable amount before the user acts. |
| `/log` | The HCS topic's messages read from the Mirror Node, newest first, each with a HashScan link |
| `/guard` | Price guard simulator. The user enters a price, an age and a previous price, and sees whether the guard would accept it and why. Clearly labelled "Simulation, not live data". |

Every transaction result shows a HashScan link.

**Health route:** `/api/health` returns OK, to satisfy "core routes return OK".

---

## 7. Optional: Pyth cross-check

Build only after everything above works.

- Add Pyth as the second source in PriceGuard (`maxDivergenceBps`, default 300 = 3%).
- Pyth is pull-based: the frontend fetches a signed update from Hermes and passes it with the transaction, paying Pyth's update fee.
- Verify the Pyth contract address and HBAR/USD price ID on Hedera testnet before starting.
- This turns "can't be fooled by a bad price" from one source into two, which is the direct answer to the Bonzo failure.

---

## 8. Tests

`packages/hardhat/test/`

**Pure logic (no Hedera needed)**
- `ReserveMath`: unit conversion, ratio, max mintable; edge cases at exactly the minimum ratio, zero collateral, very large values.
- `PriceGuard` with a mock aggregator: accepts a good price; refuses zero and negative prices; refuses a stale price; refuses an incomplete round; refuses a jump above the limit; accepts a jump at the limit; `evaluate` matches `getGuardedPrice` for the same inputs.

**Contract behaviour**
- Mint within ratio succeeds and updates debt.
- Mint above ratio returns `false`, emits `MintRejected` with code 1, and mints nothing.
- Mint with a refused price returns `false` with the guard's code and mints nothing.
- Burn always works and reduces debt.
- Withdraw that breaks the ratio is rejected; withdraw with zero debt always works.
- Only The Reserve can mint (supply key test).

**HTS in tests:** plain Hardhat has no HTS system contract. Use Hedera's Hardhat forking plugin, which emulates HTS on a forked network, or run against the Hedera local node. Verify which one the scaffold supports and document it.

**Logger**
- The same event is never logged twice.
- Restart resumes from the stored position.

**Gate checks in CI** (GitHub Actions): install, lint, build, test from a clean checkout.

---

## 9. Testnet proof (required by the gate)

Record these in the README with HashScan links:
1. Contract deployment
2. HTS token creation (showing supply key = contract)
3. One successful mint
4. One rejected mint (ratio too low) with its `MintRejected` event
5. The HCS topic containing both outcomes

Never invent a number. If something cannot be shown live, show it in tests and say so.

---

## 10. Repository layout

```
the-reserve/
  packages/
    hardhat/
      contracts/   TheReserve.sol, PriceGuard.sol, ReserveMath.sol, IReserveSource.sol
      deploy/      token creation (SDK) + contract deployment
      test/
    nextjs/
      app/         /, /vault, /log, /guard, /api/health
    logger/
      src/
  template.json
  README.md
  AGENTS.md
  LICENSE          (MIT)
  .env.example
  .github/workflows/ci.yml
```

---

## 11. README outline (30 points live here)

1. **What it is**, the one line and a short paragraph
2. **Why it exists**: issuing a backed token safely; the Bonzo lesson in two sentences, with a source link
3. **Quick start**: `npm create scaffold-hbar@latest -- --template <owner>/<repo>` with your real owner and repo, then exact commands to run. Mention the short form without `--` only if tested and working
4. **Prerequisites**: Node 20.18.3+, a Hedera testnet account, where to get test HBAR
5. **Environment variables** table: name, purpose, example, where to get it
6. **Architecture** diagram: user → The Reserve → PriceGuard → Chainlink; The Reserve → HTS; events → logger → HCS → Mirror Node → UI
7. **How the reserve rule works** with a worked example
8. **How the price guard works**: each check and its reason code
9. **Hedera gotchas**: units, association, supply key, system contract response codes
10. **Testnet proof**: HashScan links from section 9
11. **Upgrade path**: plugging in a Proof of Reserve feed via `IReserveSource`
12. **Limits**: no liquidation in v1, HBAR-only collateral, testnet only, not audited
13. **Extending the template**: other collateral, other feeds, liquidation, governance
14. **Licence**

---

## 12. Out of scope for v1

State these in the README under "Limits".
- Liquidation of under-collateralised positions. In v1 a position below the ratio simply cannot mint or withdraw until topped up or repaid.
- Collateral other than HBAR.
- Mainnet deployment.
- Governance.

---

## 13. Verify before building

| Item | Why |
|---|---|
| Late registration is accepted | The brief does not say. Confirm with Hedera first. |
| HBAR/USD feed on testnet `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` | From Chainlink's feed directory. Read it once and record the heartbeat and decimals. |
| HBAR/USD feed on mainnet `0xAF685FB45C12b92b5054ccb9313e135525F9b5d5` | For the README's mainnet table only. |
| `template.json` schema | Copy the structure from an existing scaffold-hbar template; do not guess fields. |
| HTS emulation for tests | Confirm the forking plugin or local node works with the scaffold. |
| Token association method | Confirm the HIP-719 `associate()` call works from the chosen wallet setup. |
| Pyth address and price ID on testnet | Only if building section 7. |
