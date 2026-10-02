import { ethers, network, artifacts } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

/** 1 HBAR in tinybars. Inside Hedera contracts msg.value is in tinybars (8 decimals). */
export const HBAR = 100_000_000n;
/** 1 token unit with 6 decimals. */
export const USD = 1_000_000n;
/** Chainlink HBAR/USD uses 8 decimals: $0.10 = 10_000_000. */
export const price = (usd: number) => BigInt(Math.round(usd * 1e8));

export const MAX_STALENESS = 90_000n; // 24 h heartbeat + 1 h margin
export const MAX_JUMP_BPS = 2_000n; // 20%
export const MIN_RATIO_BPS = 15_000n; // 150%

export const Reason = {
  OK: 0,
  RATIO_TOO_LOW: 1,
  PRICE_STALE: 2,
  PRICE_MALFORMED: 3,
  PRICE_JUMP: 4,
  SOURCE_DISAGREES: 5,
  NOT_ASSOCIATED: 6,
} as const;

/** Installs the mock HTS system contract at 0x167, where production code expects the real one. */
export async function installMockHts() {
  const artifact = await artifacts.readArtifact("MockHTS");
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, artifact.deployedBytecode]);
  return ethers.getContractAt("MockHTS", HTS_ADDRESS);
}

export async function deployGuard() {
  const feed = await ethers.deployContract("MockAggregator");
  await feed.setPrice(price(0.1), await time.latest());
  const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), MAX_STALENESS, MAX_JUMP_BPS]);
  return { feed, guard };
}

/** Full system: feed, guard, reserve bound to the guard, token created, alice associated. */
export async function deployReserve() {
  const [deployer, alice, bob] = await ethers.getSigners();
  const hts = await installMockHts();
  const { feed, guard } = await deployGuard();
  const reserve = await ethers.deployContract("TheReserve", [await guard.getAddress(), MIN_RATIO_BPS]);
  await guard.bindConsumer(await reserve.getAddress());
  await reserve.createToken("Reserve USD", "rUSD", { value: 10n * HBAR });
  const token = await ethers.getContractAt("MockHtsToken", await reserve.token());
  await token.connect(alice).associate();
  return { deployer, alice, bob, hts, feed, guard, reserve, token };
}
