import { useAccount } from "wagmi";
import { useHederaWallet } from "~~/services/hedera/HederaWalletProvider";

/**
 * The account the app acts for: an EVM wallet (MetaMask and other WalletConnect EIP-155 wallets) or a
 * Hedera-native wallet (Kabila, HashPack). `address` is the EVM address the contracts see as msg.sender.
 */
export function useReserveAccount(): {
  address?: `0x${string}`;
  kind?: "evm" | "hedera";
  accountId?: string;
} {
  const { address } = useAccount();
  const hedera = useHederaWallet();
  if (address) return { address: address as `0x${string}`, kind: "evm" };
  if (hedera.evmAddress) return { address: hedera.evmAddress, kind: "hedera", accountId: hedera.accountId };
  return {};
}
