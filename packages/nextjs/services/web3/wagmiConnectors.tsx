import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

const wallets = [metaMaskWallet, walletConnectWallet];

const DEV_CHAIN_IDS = new Set<number>([chains.hardhat.id, chains.foundry.id, chains.hederaTestnet.id]);

const hasDevNetwork = scaffoldConfig.targetNetworks.some(n => DEV_CHAIN_IDS.has(n.id));

export const wagmiConnectors = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const walletGroups = [
    {
      groupName: "Supported Wallets",
      wallets,
    },
  ];

  // The burner wallet is a throwaway key kept in the browser and it connects itself on load. It is for local
  // development only, so a deployed site never connects visitors to an empty, unfunded address.
  const servedLocally = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (scaffoldConfig.enableBurnerWallet && hasDevNetwork && servedLocally) {
    walletGroups.push({
      groupName: "Development",
      wallets: [rainbowkitBurnerWallet],
    });
  }

  // Shown by wallets when they ask the user to connect.
  return connectorsForWallets(walletGroups, {
    appName: "The Reserve",
    appDescription: "An HTS token that can't be minted beyond its HBAR reserves.",
    appUrl: window.location.origin,
    appIcon: `${window.location.origin}/icon-512.png`,
    projectId: scaffoldConfig.walletConnectProjectId,
  });
};
