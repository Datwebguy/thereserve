import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { burner } from "burner-connector";
import { type Transport, fallback, http } from "viem";
import * as chains from "viem/chains";
import type { CreateConnectorFn } from "wagmi";
import scaffoldConfig, { ScaffoldConfig } from "~~/scaffold.config";

const { targetNetworks } = scaffoldConfig;

/**
 * EVM networks the app reads from and EVM wallets connect to. The local fork only appears in
 * development builds, so the deployed site never offers it.
 */
export const enabledChains = targetNetworks.filter(
  network => network.id !== chains.hardhat.id || process.env.NODE_ENV === "development",
);

const transports: Record<number, Transport> = Object.fromEntries(
  enabledChains.map(chain => {
    const override = (scaffoldConfig.rpcOverrides as ScaffoldConfig["rpcOverrides"])?.[chain.id];
    return [chain.id, fallback([...(override ? [http(override)] : []), http()])];
  }),
);

// The burner wallet is a throwaway key kept in the browser and it connects itself on load. It is for
// local development only, so a deployed site never connects visitors to an empty, unfunded address.
const servedLocally = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

/**
 * AppKit's wagmi adapter: EVM wallets (MetaMask and every WalletConnect EIP-155 wallet). Its wagmi
 * config backs all of the app's contract reads and EVM writes.
 */
export const wagmiAdapter = new WagmiAdapter({
  networks: [...enabledChains] as AppKitNetwork[],
  projectId: scaffoldConfig.walletConnectProjectId,
  ssr: true,
  transports,
  pollingInterval: scaffoldConfig.pollingInterval,
  // burner-connector bundles its own viem, so its connector type differs only in that copy's types.
  connectors: scaffoldConfig.enableBurnerWallet && servedLocally ? [burner() as unknown as CreateConnectorFn] : [],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
