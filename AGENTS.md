# AGENTS.md

Guidance for AI coding agents working on **The Reserve**, a scaffold-hbar template. Read `README.md` first.

## What this project is

A template for issuing a USD-denominated HTS token backed by HBAR held in a contract. The contract values the HBAR with Chainlink's HBAR/USD feed, refuses to mint beyond a collateral ratio, and refuses prices that are stale, malformed or jump too far. Every contract event is logged to an HCS topic by `packages/logger`.

## Layout

| Path | Contents |
|---|---|
| `packages/hardhat/contracts/TheReserve.sol` | Token creation, deposits, mint, burn, withdraw, ratio checks |
| `packages/hardhat/contracts/PriceGuard.sol` | Chainlink read plus safety checks; `peek` and `simulate` views |
| `packages/hardhat/contracts/ReserveMath.sol` | Pure math: units, ratio, max mintable |
| `packages/hardhat/contracts/ReasonCodes.sol` | Reason codes shared by events, logger and UI |
| `packages/hardhat/contracts/IReserveSource.sol` | Interface for plugging in other reserve sources |
| `packages/hardhat/contracts/interfaces/` | HTS system contract, response codes, Chainlink interface |
| `packages/hardhat/contracts/test/` | Test-only mocks: `MockHTS` (installed at `0x167`), `MockAggregator`, `ReserveMathHarness` |
| `packages/hardhat/deploy/` | Deploys PriceGuard and TheReserve, binds the guard, has TheReserve create its token |
| `packages/hardhat/scripts/demo.ts` | Proof run: associate, deposit, mint, refused mint, with HashScan links |
| `packages/hardhat/test/` | Unit tests (offline) and `test/fork/` (testnet fork) |
| `packages/hardhat/utils/hedera.ts` | Feed addresses, HBAR value conversion for scripts, HashScan links |
| `packages/nextjs/` | Frontend: `/`, `/vault`, `/log`, `/guard`, `/api/health` |
| `packages/nextjs/utils/reserve.ts` | Reason code labels, units, formatting, HashScan links for the UI |
| `packages/logger/` | Mirror Node watcher that posts contract events to HCS |

## Commands

The repo uses Yarn workspaces. Projects scaffolded with npm get the same scripts as `npm run <name>`.

```bash
# install
yarn install
# lint (all packages)
yarn lint
# build (compile contracts, build logger, build Next.js)
yarn build
# test contracts (offline) and the logger
yarn test
# contract tests only / testnet-fork tests (needs network)
yarn hardhat:test
yarn hardhat:test:fork
# local node forking testnet, then deploy to it
yarn hardhat:chain
yarn deploy --network localhost
# deploy to testnet and run the proof transactions
yarn deploy --network hederaTestnet
yarn hardhat:demo --network hederaTestnet
# run the frontend
yarn start
# run the logger
yarn logger
```

## Rules that must not be broken

1. **Only The Reserve contract can mint.** The HTS token's supply key and treasury are the contract, which creates the token itself with no admin key. Never add another minting path or an admin mint.
2. **Every price goes through PriceGuard.** Never read the Chainlink feed directly from The Reserve.
3. **`mint` and `withdraw` return `false` and emit a rejection event instead of reverting** when a rule blocks them, so the attempt can be logged. Keep it that way.
4. **Burning never depends on a price.** Users must always be able to reduce debt.
5. **HBAR inside contracts is in tinybars (8 decimals).** Convert in `ReserveMath` only. Off-chain, send weibars (18 decimals) through the relay and tinybars on a local Hardhat chain (`hbarValue` / `hbarToValue`).
6. **Check association before any HTS transfer** and surface `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` clearly.
7. **Check every HTS system contract response code.**
8. **Never present simulated or mock prices as live.** The `/guard` page is labelled as a simulation.
9. **No secrets in the repo.** Only `.env.example`.
10. **The logger must stay idempotent:** never post the same event (`txHash:logIndex`) twice, and resume after restart.
11. **No AI attribution anywhere.** Do not add AI tools or agents as authors or co-authors: no `Co-Authored-By` lines, no "Generated with" footers in commits or PRs, and no AI credits in code comments, docs or `template.json`. The repository owner is the sole author.

## Making changes

- Add or update a test for every behaviour change.
- If you add a reason code, update `ReasonCodes.sol`, the table in `README.md`, and `packages/nextjs/utils/reserve.ts` together.
- If you add or change a contract event, update `packages/logger/src/events.ts`; `test/events.test.ts` fails until they match.
- If you change guard parameters or defaults, update the README's parameter table and `packages/hardhat/.env.example`.
- Keep pure logic in `ReserveMath` so it stays testable without Hedera.

## Testing HTS

Plain Hardhat has no HTS system contract. Unit tests install `MockHTS` at `0x167` with `hardhat_setCode` (see `test/helpers.ts`), so production code keeps the hard-coded system address. Do not make the HTS address configurable to ease testing. `MockHTS` returns Hedera's response codes for missing supply key, association, balance and allowance; extend it when a test needs another rule. The fork tests run the same flow against Hedera's `system-contracts-forking` emulation, which does not enforce association.

## Common tasks

- **Add a collateral type:** add a new `IReserveSource` implementation with its own price feed and guard; do not change the HBAR path.
- **Plug in a Proof of Reserve feed:** implement `IReserveSource` with the reserve feed and switch The Reserve to it at deployment.
- **Add liquidation:** out of scope for v1. Design it as a separate contract that calls The Reserve, with its own tests.
