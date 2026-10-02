# Handoff

Temporary file for moving this build to a new session. Delete before submitting.

## Read in this order

1. `docs/BUILD_SPEC.md` — the full build spec
2. `AGENTS.md` — rules for coding agents
3. `docs/research/verification-notes.md` — what was checked and why the design changed
4. `docs/research/idea-research-report.md` — the original research
5. `docs/template.json.draft` — placeholder; copy the real schema from an existing scaffold-hbar template

## Summary

**The Reserve:** a token that can't be minted beyond its reserves, and can't be fooled by a bad price.

- Hedera Scaffold-HBAR Template Bounty. Deadline Sun 4 Oct 2026, 11:59 PM ET (5 Oct, 03:59 UTC).
- Users lock HBAR; Chainlink HBAR/USD values it; the contract mints a USD-denominated HTS token only above a 150% ratio. Supply key and treasury are the contract.
- PriceGuard refuses zero, stale, incomplete-round and over-20%-jump prices. Optional Pyth cross-check.
- Blocked mints return `false` and emit an event so the logger can post every action to HCS.

## Rules

- The repository owner is the only author. No AI as author or co-author anywhere.
- Official scaffold command: `npm create scaffold-hbar@latest -- --template <owner>/<repo>`. Test the short form too.
- Repo must be public with an MIT licence before submitting.
- Never present fake or simulated data as live.

## Still to confirm

- Late registration is accepted.
- HBAR/USD testnet feed reads correctly on-chain.
- `template.json` schema.
- How to run HTS in tests (forking plugin or local node).
- Token association method from the chosen wallet setup.
