# Idea research report: Scaffold-HBAR Template Bounty

Output of the idea-research prompt (`idea-research-prompt-hedera.txt`), saved as received. Its top pick, ReserveGate, became **The Reserve**. Read `verification-notes.md` next to this file: the report's main pick depended on a Chainlink Proof of Reserve feed that does not exist publicly on Hedera, and the design was changed because of that.

---

This bounty is not a product contest. It pays for a scaffold other developers will start from, and the rubric weights execution over novelty. The recommendation below is the template that still has a clean gap, with the research that killed the obvious alternatives.

Submissions close Sunday 4 October 2026, 11:59 PM ET.

## 1. Judges decoded

Source: the [full brief](https://hedera.com/blog/scaffold-hbar-template-bounty/) and the [bounty page](https://hedera.com/scaffold-hbar-template-bounty/).

| Criterion | Points | What a 5 looks like |
|---|---|---|
| Ecosystem integration | 35 | A named protocol (SaucerSwap, Lambdaplex, SilkSuite, Chainlink, Supra, Pyth, Axelar, LayerZero, CCIP, lending, storage) does work the template cannot do without. Removing it breaks the point. An SDK call to tick a box scores low. Testnet missing is allowed if documented as read-only or forked-mainnet. |
| Documentation quality | 30 | A stranger goes from `npm create` to a running app to understanding the pattern with no help. Setup, prerequisites, env vars, architecture, and a working `AGENTS.md`. |
| Code quality | 20 | Idiomatic monorepo, meaningful tests, error handling, no dead code. |
| Hedera service depth | 15 | Several of HTS, HCS, HSS, Solidity — or one used with real depth. A single token transfer does not score. |

What Hedera actually wants: more developers starting from `npm create scaffold-hbar@latest -- --template owner/repo`, with templates listed in the docs under the author's name even if they do not place. Five prizes of $2,000 from a $10,000 pool, only for submissions that clear the gate. The brief's judges' note: a well-built template for a common pattern beats a novel one nobody needs. Suggested areas are asset tokenization, payments, DeFi, and consumer engagement.

Hard gate (pass/fail, nothing reaches the panel otherwise):

- Scaffolds with `npm create scaffold-hbar@latest -- --template owner/repo`
- Valid `template.json`, `README.md`, `AGENTS.md`
- Install, lint, and build pass from a fresh scaffold; app boots; core routes return OK
- At least one Hedera service, with a HashScan or mirror-node link
- No committed secrets or `.env`; MIT; original code
- Monorepo with `packages/` for contracts and frontend; Next.js; Hardhat or Foundry; npm or Yarn; Node 20.18.3+
- Harness spec and validators only if Harness was used (recommended, not required)

## 2. Problem list

1. **Receiving an HTS token fails until the account associates it.** `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; contracts cannot associate on a user's behalf. [SaucerSwap troubleshooting](https://docs.saucerswap.finance/resources/troubleshooting), [Fireblocks](https://developers.fireblocks.com/docs/add-a-hedera-asset-wallet), [Stack Overflow](https://stackoverflow.com/questions/76980638/how-do-you-associate-dissociate-an-hts-token-using-evm-transaction).
2. **Wrapped HBAR is a footgun.** SaucerSwap says do not call WHBAR directly or grant it an open allowance; use `WhbarHelper`. [WHBAR overview](https://docs.saucerswap.finance/developers/whbar/overview).
3. **A bad oracle verifier drained a Hedera lender.** On 11 July 2026 an attacker used a flawed Supra verifier to inflate SAUCE and borrow about $9.05 million from Bonzo Lend. [The Block](https://www.theblock.co/news/defi/2026-07-11-hedera-lending-protocol-bonzo-lend-hit-for-9-million-after-supra-verifier-accepts-manipulated-price-update-407960).
4. **Atomic batches can no longer carry smart-contract calls** (from September 2026, at most one contract call, last). [Hedera blog](https://hedera.com/blog/atomic-batch-transactions-no-longer-support-smart-contract-calls/).
5. **Royalty fees are not actually enforceable** if transfer and payment are split; fee collectors must be associated. [Custom fees](https://docs.hedera.com/native/tokens/custom-fees).
6. **The old bridge is dead.** Hashport decommissioned 31 May 2026. [SaucerSwap bridge docs](https://docs.saucerswap.finance/tutorials/bridge).
7. **Institutions already pay for an immutable log, built bespoke** (SAFE Health, AVC Global, Mirsad). [SAFE](https://hedera.com/users/safe-health-systems-inc), [AVC](https://hedera.com/users/avc-global), [Mirsad](https://hedera.com/case-study/mirsadai/).
8. **HTS prices on aggregators go stale** (Bonzo warning, Oct 2025). [Bonzo](https://x.com/bonzo_finance/status/1986290793217163762).
9. **HCS got more expensive** ($0.0001 to $0.0008 per message, Jan 2026). [Coverage](https://www.ainvest.com/news/8x-fee-hike-undercuts-hedera-micropayments-pitch-2609/).
10. **UK regulators flagged bridge, oracle and key-management risk** in FS26/1. [Disruption Banking](https://www.disruptionbanking.com/2026/09/23/uk-flags-bridge-risk-as-hedera-pushes-interoperability/).
11. **HCS-native apps fail in the off-chain glue.** Hacken's CollaFi audit: 49 issues, 10 high, in backend, auth and transaction handling. [Hacken](https://hacken.io/case-studies/collafi-audit/).

## 3. Landscape

**Built-in scaffold-hbar templates:** blank; Hedera native (HTS + HCS + Schedule); oracles (Chainlink, Pyth, Supra — read a price); on-chain cron; bridge; tokenize subscriptions; x402 pay-per-use; cross-chain DCA. [Scaffold HBAR](https://hedera.com/scaffold-hbar/), [docs](https://docs.hedera.com/solutions/tools/scaffold-hbar).

**Already submitted against this bounty (public repos):**
- [SaucerPay](https://github.com/BikramBiswas786/saucerpay) — invoice escrow; SaucerSwap used as a quote API.
- [QuoteProof](https://github.com/ref-dev22/quoteproof-template) — USD quote priced by Chainlink, verifiable against the oracle round and an HCS anchor.
- [LettermanLabs/hedera-lending-market](https://github.com/LettermanLabs/hedera-lending-market) — supply/borrow, Pyth prices, SaucerSwap V1 liquidations.

**Overdone, drop:** generic AI chatbot on HCS, NFT marketplace, DAO voting, portfolio tracker, another proof wall, another price reader, another bridge demo, another invoice board that only quotes SaucerSwap.

## 4–5. Ideas and scoring (summary)

Top scores out of 40: PoR-gated HTS mint (37), swap that executes with association and WhbarHelper (35), invoice paid via a real SaucerSwap swap (32). Others scored 19–28, including KYC-keyed HTS, price-banded scheduled pay, lending market, quote receipt, x402 refunds, proof wall and subscription rental.

## 6. Top 3

### ReserveGate (chosen, became The Reserve)
**Pitch:** A token that refuses to mint unless reserves cover it, and writes every attempt to a public log.
**Planned load-bearing integration:** Chainlink Proof of Reserve. **See `verification-notes.md`: no public PoR feed exists on Hedera, so The Reserve values on-chain HBAR reserves with Chainlink HBAR/USD instead.**
**Magic moment:** mint above reserves, it is refused, and the HCS topic on HashScan already shows the rejected attempt.

### SwapPath (fallback)
**Pitch:** A swap starter that associates the token and wraps HBAR the way SaucerSwap says you must.
**Load-bearing:** SaucerSwap router plus `WhbarHelper`. **Risk:** testnet pool liquidity.

### BandPay
**Pitch:** A scheduled payment that only fires if a published price is still inside the band you set.
**Risk:** showing a scheduled call fire reliably in the demo.

## 7. Recommendation (as given)

Build ReserveGate. First steps: confirm a readable reserve feed; build the gated mint with HTS supply key on the contract and HCS logging of both outcomes; write `template.json`, `AGENTS.md` and a setup path that passes install, lint and build from a fresh scaffold.

## 8. Open questions (as given)

- Whether a late registrant can still submit.
- Proof of Reserve feed address on Hedera testnet (now answered: none in Chainlink's public directory).
- Builder skills, time and budget were not provided.
- If no reserve feed can be read, switch approach rather than stub reserves.
