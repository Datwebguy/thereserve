/**
 * Helpers for wallets connected through Hedera's native WalletConnect (Kabila, HashPack and others).
 * Kept free of React and of app path aliases so they can be unit-tested directly.
 */
import { type Abi, type Hex, encodeFunctionData } from "viem";

/** A contract log as the Mirror Node returns it in /api/v1/contracts/results/{id}. */
export type MirrorLog = { address: string; topics: string[]; data: string };

/** The parts of a Mirror Node contract result the app needs. */
export type MirrorContractResult = { hash: string; result: string; error_message?: string | null; logs: MirrorLog[] };

/**
 * Converts an SDK transaction ID ("0.0.123@1700000000.000123456") to the form the Mirror Node uses in
 * URLs ("0.0.123-1700000000-000123456"). IDs already in that form are returned unchanged.
 */
export function toMirrorTransactionId(transactionId: string): string {
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId.trim());
  if (!match) {
    if (/^\d+\.\d+\.\d+-\d+-\d+$/.test(transactionId.trim())) return transactionId.trim();
    throw new Error(`Not a Hedera transaction ID: ${transactionId}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * The entity ID ("0.0.N") encoded in a long-zero EVM address (twelve zero bytes, then N), or undefined
 * for any other address. HTS tokens such as rUSD have long-zero addresses; contracts deployed through
 * the JSON-RPC relay do not, and need a Mirror Node lookup instead.
 */
export function entityIdFromLongZero(address: string): string | undefined {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex) || !hex.startsWith("0".repeat(24))) return undefined;
  const num = BigInt(`0x${hex.slice(24)}`);
  return num > 0n ? `0.0.${num}` : undefined;
}

/** Mirror Node logs in the shape viem's parseEventLogs expects. */
export function mirrorLogsToViem(logs: MirrorLog[]) {
  return logs.map(log => ({
    address: log.address as Hex,
    topics: log.topics as [Hex, ...Hex[]],
    data: (log.data && log.data !== "0x" ? log.data : "0x") as Hex,
  }));
}

/** ABI-encoded call data as the byte array ContractExecuteTransaction.setFunctionParameters takes. */
export function callData(abi: Abi, functionName: string, args: readonly unknown[] = []): Uint8Array {
  const hex = encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
  return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
