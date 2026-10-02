# Verification notes

Checks run on 2 Oct 2026 against the idea research report.

## Confirmed

- **Competing bounty repos exist:** [SaucerPay](https://github.com/BikramBiswas786/saucerpay), [QuoteProof](https://github.com/ref-dev22/quoteproof-template), [LettermanLabs lending market](https://github.com/LettermanLabs/hedera-lending-market).
- **Built-in templates** ([docs](https://docs.hedera.com/solutions/tools/scaffold-hbar)): Blank, Hedera Native, Onchain Cron Job, Cross-chain DCA, Bridge, Oracles, Tokenize Subscriptions, x402 Pay-Per-Use. None gates minting on an oracle or reserve.
- **Bonzo Lend exploit:** 11 July 2026, about $9.05M lost after Supra's verifier accepted a price update with a zeroed BLS signature, inflating SAUCE by about 12 orders of magnitude. Not a Bonzo or Hedera network flaw. [Cointelegraph](https://cointelegraph.com/news/bonzo-lend-9m-oracle-exploit-hedera), [The Defiant](https://thedefiant.io/news/hacks/bonzo-lend-loses-9m-on-hedera-in-supra-oracle-exploit).
- **Chainlink Proof of Reserve was announced on Hedera** in December 2024. [Hedera blog](https://hedera.com/blog/hedera-adopts-the-chainlink-data-standard-to-accelerate-defi-and-tokenized-rwa-adoption).

## Not confirmed: the key problem

**Chainlink's public feed directory lists no Proof of Reserve feeds on Hedera.**

- Mainnet: 27 feeds, all price feeds. [Directory](https://reference-data-directory.vercel.app/feeds-hedera-mainnet.json)
- Testnet: 7 price feeds. [Directory](https://reference-data-directory.vercel.app/feeds-hedera-testnet.json)

So the original ReserveGate design (gate minting on a PoR feed) cannot be built honestly. The Reserve keeps reserves on-chain as HBAR collateral and values them with the HBAR/USD price feed, with a price guard, and exposes an `IReserveSource` interface for plugging in a real PoR feed later.

## Chainlink feeds to use

| Network | Feed | Proxy address |
|---|---|---|
| Testnet | HBAR / USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` |
| Mainnet | HBAR / USD | `0xAF685FB45C12b92b5054ccb9313e135525F9b5d5` |

Addresses come from Chainlink's directory. Read each once on-chain and record decimals and heartbeat before relying on them.

Other testnet feeds listed: USDC/USD, ETH/USD, LINK/USD, BTC/USD, USDT/USD, DAI/USD.

## Not checked

The report's claims about the atomic-batch change, the Hashport shutdown, the HCS fee increase, and the UK FS26/1 note were not independently verified. Check them before quoting them in the README.

## Command note

Hedera's pages show two forms:
- Brief (used for the gate): `npm create scaffold-hbar@latest -- --template owner/repo`
- Bounty page: `npm create scaffold-hbar@latest --template your-org/your-repo`

The `--` passes `--template` through to the scaffold tool. Treat the `--` form as official and test both.
