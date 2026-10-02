import type { HardhatRuntimeEnvironment } from "hardhat/types";

/** Chainlink HBAR/USD proxy addresses, from https://docs.chain.link/data-feeds/price-feeds/addresses?network=hedera */
export const CHAINLINK_HBAR_USD: Record<string, string> = {
  hederaTestnet: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
  hederaMainnet: "0xAF685FB45C12b92b5054ccb9313e135525F9b5d5",
  // The local node (`yarn hardhat:chain`) forks testnet, so the testnet feed is readable there.
  localhost: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
  hardhat: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
};

/** True when transactions go through the Hedera JSON-RPC relay rather than a local Hardhat EVM. */
export function isHederaNetwork(hre: HardhatRuntimeEnvironment): boolean {
  return hre.network.name === "hederaTestnet" || hre.network.name === "hederaMainnet";
}

/**
 * The `value` to send so a contract receives `hbar` HBAR.
 *
 * Hedera gotcha: the JSON-RPC relay takes `value` in weibars (18 decimals) and the contract sees
 * tinybars (8 decimals) in msg.value. A local Hardhat EVM passes `value` through unchanged, so
 * there we send the tinybar amount directly to keep the contract's numbers the same.
 */
export function hbarValue(hre: HardhatRuntimeEnvironment, hbar: string): bigint {
  return isHederaNetwork(hre) ? hre.ethers.parseEther(hbar) : hre.ethers.parseUnits(hbar, 8);
}

export function hashscanNetwork(hre: HardhatRuntimeEnvironment): string {
  return hre.network.name === "hederaMainnet" ? "mainnet" : "testnet";
}

export function mirrorNodeUrl(hre: HardhatRuntimeEnvironment): string {
  return hre.network.name === "hederaMainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

export function hashscanTx(hre: HardhatRuntimeEnvironment, txHash: string): string {
  return `https://hashscan.io/${hashscanNetwork(hre)}/transaction/${txHash}`;
}

export function hashscanContract(hre: HardhatRuntimeEnvironment, address: string): string {
  return `https://hashscan.io/${hashscanNetwork(hre)}/contract/${address}`;
}

/** HTS tokens have long-zero EVM addresses: the last 8 bytes are the entity number. */
export function tokenIdFromAddress(address: string): string {
  return `0.0.${BigInt(address)}`;
}

export function hashscanToken(hre: HardhatRuntimeEnvironment, address: string): string {
  return `https://hashscan.io/${hashscanNetwork(hre)}/token/${tokenIdFromAddress(address)}`;
}

/** Reads a decimal setting from the environment, with a default. */
export function envNumber(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return BigInt(raw.trim());
}
