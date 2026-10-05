"use client";

import { useState } from "react";
import { useHederaWallet } from "~~/services/hedera/HederaWalletProvider";

/**
 * AppKit's own Connect button. It opens WalletConnect's full wallet list: Hedera wallets such as
 * Kabila and HashPack connect through the Hedera namespace (any account), EVM wallets such as
 * MetaMask through EIP-155. Once connected it shows the account and a menu to switch or disconnect.
 */
export const ConnectWallet = () => {
  const { ready, open } = useHederaWallet();
  const [opening, setOpening] = useState(false);
  if (!ready) {
    // Usable straight away: the wallet list loads on click instead of leaving the button dead.
    return (
      <button
        className="btn btn-primary btn-sm"
        type="button"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          try {
            await open();
          } finally {
            setOpening(false);
          }
        }}
      >
        {opening ? <span className="loading loading-spinner loading-xs" /> : "Connect Wallet"}
      </button>
    );
  }
  return <appkit-button balance="hide" label="Connect Wallet" />;
};
