"use client";

import { useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";
import scaffoldConfig from "~~/scaffold.config";
import { useHederaWallet } from "~~/services/hedera/HederaWalletProvider";
import { hashscanNetwork } from "~~/utils/reserve";
import { notification } from "~~/utils/scaffold-hbar";

/**
 * Lets visitors connect either a Hedera-native wallet (any Hedera account) or an EVM wallet.
 * EVM wallets connect through WalletConnect's EIP-155 namespace, which Hedera wallets only allow for
 * accounts with an EVM alias; the Hedera option has no such limit.
 */
export const ConnectWallet = () => {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const hedera = useHederaWallet();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => menuRef.current?.removeAttribute("open");
  useOutsideClick(menuRef, close);

  if (isConnected) return <RainbowKitCustomConnectButton />;

  if (hedera.accountId) {
    const network = hashscanNetwork(scaffoldConfig.targetNetworks[0].id);
    return (
      <details ref={menuRef} className="dropdown dropdown-end leading-3">
        <summary className="btn btn-primary btn-sm shadow-md gap-2">{hedera.accountId}</summary>
        <ul className="dropdown-content menu z-10 p-2 mt-2 shadow-center shadow-accent bg-base-200 rounded-box gap-1 w-60">
          <li className="menu-title text-xs">Hedera wallet</li>
          <li>
            <a href={`https://hashscan.io/${network}/account/${hedera.accountId}`} target="_blank" rel="noreferrer">
              View on HashScan
            </a>
          </li>
          <li>
            <button
              className="text-error"
              type="button"
              onClick={() => {
                close();
                hedera.disconnect();
              }}
            >
              <ArrowLeftStartOnRectangleIcon className="h-5 w-5" /> Disconnect
            </button>
          </li>
        </ul>
      </details>
    );
  }

  return (
    <details ref={menuRef} className="dropdown dropdown-end leading-3">
      <summary className="btn btn-primary btn-sm shadow-md">
        {hedera.connecting ? <span className="loading loading-spinner loading-xs" /> : "Connect Wallet"}
      </summary>
      <ul className="dropdown-content menu z-10 p-2 mt-2 shadow-center shadow-accent bg-base-200 rounded-box gap-1 w-72">
        <li>
          <button
            type="button"
            className="flex flex-col items-start gap-0.5"
            onClick={async () => {
              close();
              try {
                await hedera.connect();
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                // Closing the WalletConnect window is a choice, not an error.
                if (!/reject|closed|cancel/i.test(message)) notification.error(message);
              }
            }}
          >
            <span className="font-semibold">Hedera wallet</span>
            <span className="text-xs opacity-70">Kabila, HashPack and other Hedera wallets. Any account.</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="flex flex-col items-start gap-0.5"
            onClick={() => {
              close();
              openConnectModal?.();
            }}
          >
            <span className="font-semibold">EVM wallet</span>
            <span className="text-xs opacity-70">MetaMask and other EVM wallets, on Hedera testnet (chain 296).</span>
          </button>
        </li>
      </ul>
    </details>
  );
};
