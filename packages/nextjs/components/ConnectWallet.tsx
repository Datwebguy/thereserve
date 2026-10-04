"use client";

import { useHederaWallet } from "~~/services/hedera/HederaWalletProvider";

/**
 * AppKit's own Connect button. It opens WalletConnect's full wallet list: Hedera wallets such as
 * Kabila and HashPack connect through the Hedera namespace (any account), EVM wallets such as
 * MetaMask through EIP-155. Once connected it shows the account and a menu to switch or disconnect.
 */
export const ConnectWallet = () => {
  const { ready } = useHederaWallet();
  if (!ready) {
    return (
      <button className="btn btn-primary btn-sm" type="button" disabled>
        Connect Wallet
      </button>
    );
  }
  return <appkit-button balance="hide" label="Connect Wallet" />;
};
