/**
 * Runs the proof sequence against a deployed TheReserve and prints HashScan links:
 *   1. associate the token (if needed)
 *   2. deposit HBAR
 *   3. mint within the ratio            -> Minted
 *   4. mint far above the ratio         -> MintRejected, reason code 1
 *
 * Usage: yarn hardhat:demo --network hederaTestnet
 * DEMO_DEPOSIT_HBAR sets the deposit (default 100).
 */
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import type { ContractTransactionResponse } from "ethers";

import {
  hashscanContract,
  hashscanToken,
  hashscanTx,
  hbarValue,
  isHederaNetwork,
  mirrorNodeUrl,
} from "../utils/hedera";

const HIP719 = ["function associate() returns (uint256)"];
const GAS = { associate: 1_000_000, deposit: 200_000, mint: 1_000_000 };

async function isAssociated(account: string, token: string): Promise<boolean | undefined> {
  if (!isHederaNetwork(hre)) return undefined;
  const tokenId = `0.0.${BigInt(token)}`;
  const res = await fetch(`${mirrorNodeUrl(hre)}/api/v1/accounts/${account}/tokens?token.id=${tokenId}`);
  if (!res.ok) return undefined;
  const body = (await res.json()) as { tokens?: unknown[] };
  return (body.tokens?.length ?? 0) > 0;
}

async function main() {
  const { ethers, deployments, network } = hre;
  const [signer] = await ethers.getSigners();
  if (!signer) {
    throw new Error(
      "No deployer key. Run `yarn hardhat:account:import`, then `yarn hardhat:demo --network <network>`, which decrypts it.",
    );
  }
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? undefined;
  const reserveDeployment = await deployments.get("TheReserve");
  const reserve = await ethers.getContractAt("TheReserve", reserveDeployment.address, signer);
  const guard = await ethers.getContractAt("PriceGuard", await reserve.priceGuard(), signer);
  const token = await reserve.token();
  if (token === ethers.ZeroAddress) throw new Error("TheReserve has no token yet. Run the deploy first.");

  const proof: { step: string; outcome: string; tx: string; link?: string }[] = [];
  const record = async (step: string, sent: Promise<ContractTransactionResponse>) => {
    const tx = await sent;
    const receipt = await tx.wait();
    const events = (receipt?.logs ?? [])
      .map(log => {
        try {
          return reserve.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(e => e !== null);
    const outcome = events.map(e => `${e!.name}(${e!.args.map(String).join(", ")})`).join("; ") || "ok";
    const link = isHederaNetwork(hre) ? hashscanTx(hre, tx.hash) : undefined;
    proof.push({ step, outcome, tx: tx.hash, link });
    console.log(`\n${step}\n  ${outcome}\n  ${link ?? tx.hash}`);
  };

  console.log(`Network:    ${network.name}`);
  console.log(`Account:    ${signer.address}`);
  console.log(`TheReserve: ${reserveDeployment.address}`);
  console.log(`Token:      ${token}`);

  // 1. Association. Many Hedera accounts auto-associate; check first, associate only if needed.
  const associated = await isAssociated(signer.address, token);
  if (associated === true) {
    console.log("\nToken already associated with this account.");
  } else {
    const facade = new ethers.Contract(token, HIP719, signer);
    await record("Associate token (HIP-719)", facade.associate({ gasLimit: GAS.associate, gasPrice }));
  }

  // 2. Deposit.
  const depositHbar = process.env.DEMO_DEPOSIT_HBAR || "100";
  await record(
    `Deposit ${depositHbar} HBAR`,
    reserve.deposit({ value: hbarValue(hre, depositHbar), gasLimit: GAS.deposit, gasPrice }),
  );

  // 3. Work out the limit from the price the guard would accept now.
  const [ok, price, code] = await guard.peek();
  if (!ok) throw new Error(`PriceGuard refuses the current price (reason ${code}); the demo needs an accepted price.`);
  const collateral = await reserve.collateral(signer.address);
  const debt = await reserve.debt(signer.address);
  const minRatio = await reserve.minRatioBps();
  const limit = (collateral * price * 10_000n) / 10n ** 10n / minRatio;
  const room = limit > debt ? limit - debt : 0n;
  console.log(`\nPrice $${ethers.formatUnits(price, 8)}; can mint up to ${ethers.formatUnits(room, 6)} more`);
  if (room < 2n) throw new Error("Not enough collateral to demonstrate a mint; raise DEMO_DEPOSIT_HBAR.");

  const within = room / 2n;
  await record(
    `Mint ${ethers.formatUnits(within, 6)} (within the ratio)`,
    reserve.mint(within, { gasLimit: GAS.mint, gasPrice }),
  );

  // 4. Ask for far more than the ratio allows: rejected with reason code 1, logged on-chain.
  const tooMuch = room * 3n;
  await record(
    `Mint ${ethers.formatUnits(tooMuch, 6)} (above the ratio)`,
    reserve.mint(tooMuch, { gasLimit: GAS.mint, gasPrice }),
  );

  if (isHederaNetwork(hre)) {
    console.log(`\nContract: ${hashscanContract(hre, reserveDeployment.address)}`);
    console.log(`Token:    ${hashscanToken(hre, token)}`);
  }

  const out = path.join(__dirname, "..", "deployments", network.name, "demo-proof.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify({ network: network.name, reserve: reserveDeployment.address, token, proof }, null, 2),
  );
  console.log(`\nSaved ${path.relative(process.cwd(), out)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
