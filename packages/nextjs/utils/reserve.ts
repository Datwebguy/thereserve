import { formatUnits, parseEther, parseUnits } from "viem";
import { hedera, hederaTestnet } from "viem/chains";

/**
 * Why a mint, withdraw or price was refused.
 * Keep in sync with packages/hardhat/contracts/ReasonCodes.sol and the README table.
 */
export const REASONS: Record<number, { title: string; detail: string }> = {
  0: { title: "Accepted", detail: "Every check passed." },
  1: { title: "Ratio too low", detail: "The action would leave the account below the minimum collateral ratio." },
  2: { title: "Price stale", detail: "The feed's answer is older than the guard's maximum age." },
  3: {
    title: "Price malformed",
    detail: "The answer is zero or negative, the round is incomplete or out of order, or the feed could not be read.",
  },
  4: { title: "Price jumped", detail: "The price moved more than the allowed amount since the last accepted price." },
  5: { title: "Sources disagree", detail: "Reserved for a second price source. Not enabled in v1." },
  6: {
    title: "Token not associated",
    detail: "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT: associate the token with your account before minting.",
  },
};

export const reasonTitle = (code: number | bigint | undefined) =>
  code === undefined ? "" : (REASONS[Number(code)]?.title ?? `Unknown reason ${code}`);

/** Token amounts have 6 decimals. */
export const TOKEN_DECIMALS = 6;
/** HBAR inside contracts is in tinybars: 8 decimals. */
export const TINYBAR_DECIMALS = 8;
/** Chainlink HBAR/USD answers have 8 decimals. */
export const PRICE_DECIMALS = 8;
/** Ratio views return max uint256 when there is no debt. */
export const NO_DEBT_RATIO = 2n ** 256n - 1n;

export const isHederaChain = (chainId: number) => chainId === hedera.id || chainId === hederaTestnet.id;

/**
 * The transaction `value` that delivers `hbar` HBAR to a contract.
 * Hedera gotcha: the JSON-RPC relay takes value in weibars (18 decimals) and the contract receives
 * tinybars (8 decimals). A local Hardhat chain passes value through unchanged, so there we send tinybars.
 */
export function hbarToValue(hbar: string, chainId: number): bigint {
  return isHederaChain(chainId) ? parseEther(hbar) : parseUnits(hbar, TINYBAR_DECIMALS);
}

export const parseHbarToTinybars = (hbar: string) => parseUnits(hbar, TINYBAR_DECIMALS);
export const parseToken = (amount: string) => parseUnits(amount, TOKEN_DECIMALS);

const trim = (s: string, max: number) => {
  const [int, frac = ""] = s.split(".");
  const f = frac.slice(0, max).replace(/0+$/, "");
  return f ? `${Number(int).toLocaleString("en-US")}.${f}` : Number(int).toLocaleString("en-US");
};

export const formatHbar = (tinybars?: bigint) =>
  tinybars === undefined ? "–" : `${trim(formatUnits(tinybars, TINYBAR_DECIMALS), 4)} HBAR`;
export const formatToken = (amount?: bigint, symbol = "") =>
  amount === undefined ? "–" : `${trim(formatUnits(amount, TOKEN_DECIMALS), 6)}${symbol ? ` ${symbol}` : ""}`;
export const formatUsd = (amount?: bigint) =>
  amount === undefined ? "–" : `$${trim(formatUnits(amount, TOKEN_DECIMALS), 2)}`;
export const formatPrice = (price?: bigint) =>
  price === undefined || price === 0n ? "–" : `$${trim(formatUnits(price, PRICE_DECIMALS), 8)}`;
export const formatRatio = (bps?: bigint) => {
  if (bps === undefined) return "–";
  if (bps === NO_DEBT_RATIO) return "No debt";
  return `${trim(formatUnits(bps, 2), 1)}%`;
};

export function formatAge(seconds?: bigint | number) {
  if (seconds === undefined) return "–";
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Same math as ReserveMath.maxMintable, for previews at a given price. */
export function maxMintable(collateralTinybars: bigint, debt: bigint, price: bigint, minRatioBps: bigint) {
  if (minRatioBps === 0n) return 0n;
  const limit = (((collateralTinybars * price) / 10n ** 10n) * 10_000n) / minRatioBps;
  return limit > debt ? limit - debt : 0n;
}

export const hashscanNetwork = (chainId: number) => (chainId === hedera.id ? "mainnet" : "testnet");
export const hashscanTx = (chainId: number, hash: string) =>
  isHederaChain(chainId) ? `https://hashscan.io/${hashscanNetwork(chainId)}/transaction/${hash}` : undefined;
export const hashscanTopic = (chainId: number, topicId: string) =>
  `https://hashscan.io/${hashscanNetwork(chainId)}/topic/${topicId}`;
export const hashscanToken = (chainId: number, tokenAddress: string) =>
  `https://hashscan.io/${hashscanNetwork(chainId)}/token/0.0.${BigInt(tokenAddress)}`;

export const mirrorNodeUrl = (chainId: number) =>
  chainId === hedera.id
    ? process.env.NEXT_PUBLIC_MIRROR_NODE_MAINNET_URL || "https://mainnet.mirrornode.hedera.com"
    : process.env.NEXT_PUBLIC_MIRROR_NODE_TESTNET_URL || "https://testnet.mirrornode.hedera.com";

/** ERC-20 and HIP-719 functions every HTS fungible token exposes at its own address. */
export const htsTokenAbi = [
  {
    type: "function",
    name: "associate",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "responseCode", type: "uint256" }],
  },
  {
    type: "function",
    name: "isAssociated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "associated", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
