# AGENTS.md

Guidance for AI coding agents working on **The Reserve**, a scaffold-hbar template. Read `README.md` first.

## What this project is

A template for issuing a USD-denominated HTS token backed by HBAR held in a contract. The contract values the HBAR with Chainlink's HBAR/USD feed, refuses to mint beyond a collateral ratio, and refuses prices that are stale, malformed or jump too far. Every contract event is logged to an HCS topic by `packages/logger`.

## Layout

| Path | Contents |
|---|---|
| `packages/hardhat/contracts/TheReserve.sol` | Deposits, mint, burn, withdraw, ratio checks |
| `packages/hardhat/contracts/PriceGuard.sol` | Chainlink read plus safety checks |
| `packages/hardhat/contracts/ReserveMath.sol` | Pure math: units, ratio, max mintable |
| `packages/hardhat/contracts/IReserveSource.sol` | Interface for plugging in other reserve sources |
| `packages/hardhat/deploy/` | Creates the HTS token with the SDK, deploys contracts |
| `packages/hardhat/test/` | Unit and behaviour tests |
| `packages/nextjs/` | Frontend: `/`, `/vault`, `/log`, `/guard`, `/api/health` |
| `packages/logger/` | Mirror Node watcher that posts contract events to HCS |

## Commands

<!-- Replace with the exact commands once the scaffold is set up. -->

```bash
# install
npm install
# lint
npm run lint
# build
npm run build
# test contracts
npm run hardhat:test
# deploy to testnet
npm run deploy -- --network testnet
# run the frontend
npm run start
# run the logger
npm run logger
```

## Rules that must not be broken

1. **Only The Reserve contract can mint.** The HTS token's supply key and treasury are the contract. Never add another minting path or an admin mint.
2. **Every price goes through PriceGuard.** Never read the Chainlink feed directly from The Reserve.
3. **`mint` and `withdraw` return `false` and emit a rejection event instead of reverting** when a rule blocks them, so the attempt can be logged. Keep it that way.
4. **Burning never depends on a price.** Users must always be able to reduce debt.
5. **HBAR inside contracts is in tinybars (8 decimals).** Convert in `ReserveMath` only.
6. **Check association before any HTS transfer** and surface `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` clearly.
7. **Check every HTS system contract response code.**
8. **Never present simulated or mock prices as live.** The `/guard` page is labelled as a simulation.
9. **No secrets in the repo.** Only `.env.example`.
10. **The logger must stay idempotent:** never post the same transaction twice, and resume after restart.
11. **No AI attribution anywhere.** Do not add AI tools or agents as authors or co-authors: no `Co-Authored-By` lines, no "Generated with" footers in commits or PRs, and no AI credits in code comments, docs or `template.json`. The repository owner is the sole author.

## Making changes

- Add or update a test for every behaviour change.
- If you add a reason code, update the table in `README.md`, the contract, and the UI together.
- If you change guard parameters or defaults, update the README's parameter table.
- Keep pure logic in `ReserveMath` so it stays testable without Hedera.

## Common tasks

- **Add a collateral type:** add a new `IReserveSource` implementation with its own price feed and guard; do not change the HBAR path.
- **Plug in a Proof of Reserve feed:** implement `IReserveSource` with the reserve feed and switch The Reserve to it at deployment.
- **Add liquidation:** out of scope for v1. Design it as a separate contract that calls The Reserve, with its own tests.
