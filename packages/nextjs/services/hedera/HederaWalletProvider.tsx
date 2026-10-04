"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { HederaProvider, hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import type { AppKit } from "@reown/appkit/react";
import { useTheme } from "next-themes";
import { hedera } from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";
import { enabledChains, wagmiAdapter } from "~~/services/web3/wagmiConfig";
import { type MirrorContractResult, entityIdFromLongZero, toMirrorTransactionId } from "~~/utils/hederaWallet";
import { mirrorNodeUrl } from "~~/utils/reserve";

/**
 * Wallet connection through Reown AppKit, WalletConnect's own modal with its full wallet list.
 *
 * Two adapters sit behind the one modal:
 * - the wagmi adapter (EIP-155) for MetaMask and other EVM wallets, which backs the app's wagmi reads;
 * - Hedera's adapter (the `hedera` namespace) for Kabila, HashPack and other Hedera wallets. Unlike
 *   EIP-155, it works with any Hedera account, including ECDSA accounts without an EVM alias.
 *
 * This provider creates AppKit once on the client and exposes the Hedera-native account, if one is
 * connected, plus a way to send contract calls signed by it.
 */

type HederaWallet = {
  /** True once AppKit is ready and the Connect button can open it. */
  ready: boolean;
  /** The connected Hedera-native account ("0.0.N"), if any. */
  accountId?: string;
  /** That account's EVM address, as the contracts see it (msg.sender). */
  evmAddress?: `0x${string}`;
  /**
   * Sends a contract call signed by the connected Hedera wallet and waits for the Mirror Node to report
   * it. `payableTinybars` is sent as msg.value (tinybars on Hedera).
   */
  callContract: (args: {
    to: string;
    data: Uint8Array;
    gas: bigint;
    payableTinybars?: bigint;
  }) => Promise<MirrorContractResult>;
};

const HederaWalletContext = createContext<HederaWallet | null>(null);

const chainId: number = scaffoldConfig.targetNetworks[0].id;
const isMainnet = chainId === hedera.id;
const mirror = mirrorNodeUrl(chainId);

async function evmAddressOf(accountId: string): Promise<`0x${string}`> {
  const res = await fetch(`${mirror}/api/v1/accounts/${accountId}`);
  if (!res.ok) throw new Error(`Mirror Node returned ${res.status} for account ${accountId}`);
  const body = (await res.json()) as { evm_address?: string };
  if (!body.evm_address) throw new Error(`No EVM address for account ${accountId}`);
  return body.evm_address as `0x${string}`;
}

async function contractIdOf(address: string): Promise<string> {
  const longZero = entityIdFromLongZero(address);
  if (longZero) return longZero;
  const res = await fetch(`${mirror}/api/v1/contracts/${address}`);
  if (!res.ok) throw new Error(`Mirror Node returned ${res.status} for contract ${address}`);
  return ((await res.json()) as { contract_id: string }).contract_id;
}

/** Polls the Mirror Node until it has indexed the transaction's contract result. */
async function waitForContractResult(transactionId: string): Promise<MirrorContractResult> {
  const url = `${mirror}/api/v1/contracts/results/${toMirrorTransactionId(transactionId)}`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as MirrorContractResult;
    if (res.status !== 404) throw new Error(`Mirror Node returned ${res.status} for ${transactionId}`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Transaction ${transactionId} was sent, but the Mirror Node has not reported it yet.`);
}

type Loaded = {
  appKit: AppKit;
  hederaProvider: HederaProvider;
  namespace: typeof hederaNamespace;
  nativeNetwork: Parameters<AppKit["switchNetwork"]>[0];
};

let appKitPromise: Promise<Loaded> | null = null;

/** Creates AppKit once per page load. */
function loadAppKit() {
  if (!appKitPromise) {
    appKitPromise = (async () => {
      const [{ createAppKit }, hwc] = await Promise.all([
        import("@reown/appkit/react"),
        import("@hashgraph/hedera-wallet-connect"),
      ]);
      const projectId = scaffoldConfig.walletConnectProjectId;
      const origin = window.location.origin;
      const metadata = {
        name: "The Reserve",
        description: "An HTS token that can't be minted beyond its HBAR reserves.",
        url: origin,
        icons: [`${origin}/icon-512.png`],
      };
      // The EVM and the native Hedera networks share a name, which showed up as two identical
      // "Hedera Testnet" rows in AppKit's Switch Network dialog. Name the native one for what it is.
      const baseNative = isMainnet
        ? hwc.HederaChainDefinition.Native.Mainnet
        : hwc.HederaChainDefinition.Native.Testnet;
      const nativeNetwork = { ...baseNative, name: `${baseNative.name} (Hedera wallets)` } as typeof baseNative;
      const hederaAdapter = new hwc.HederaAdapter({
        projectId,
        networks: [nativeNetwork],
        namespace: hwc.hederaNamespace,
      });
      const hederaProvider = await hwc.HederaProvider.init({ projectId, metadata });
      // WalletConnect sessions ask only for the hedera namespace. If the proposal also lists eip155,
      // Hedera wallets such as Kabila pick EIP-155, where only ECDSA accounts with an EVM alias can be
      // used. EVM wallets connect through their browser instead (MetaMask extension or in-app browser).
      const connect = hederaProvider.connect.bind(hederaProvider);
      hederaProvider.connect = params => {
        const hederaOnly = Object.fromEntries(
          Object.entries(params.optionalNamespaces ?? {}).filter(([namespace]) => namespace === hwc.hederaNamespace),
        );
        return connect({ ...params, namespaces: undefined, optionalNamespaces: hederaOnly });
      };
      // AppKit clears the account only when the adapter emits "disconnect", which Hedera's adapter
      // does not do for WalletConnect sessions, so Disconnect appeared to do nothing. End the session
      // (locally too, if the relay call fails or hangs) and emit the event.
      const disconnect = hederaAdapter.disconnect.bind(hederaAdapter);
      hederaAdapter.disconnect = async params => {
        const result = await Promise.race([
          disconnect(params),
          new Promise<{ connections: [] }>(resolve => setTimeout(() => resolve({ connections: [] }), 5_000)),
        ]);
        // cleanup() is private in the types; it only forgets the session locally.
        const provider = hederaProvider as unknown as { session?: unknown; cleanup: () => Promise<void> };
        if (provider.session) await provider.cleanup().catch(console.error);
        (hederaAdapter as unknown as { emit: (event: "disconnect") => void }).emit("disconnect");
        return result;
      };
      const appKit = createAppKit({
        adapters: [wagmiAdapter, hederaAdapter],
        // Hedera's provider extends WalletConnect's UniversalProvider; the types differ only in detail.
        universalProvider: hederaProvider as unknown as Parameters<typeof createAppKit>[0]["universalProvider"],
        projectId,
        metadata,
        networks: [enabledChains[0], ...enabledChains.slice(1), nativeNetwork] as Parameters<
          typeof createAppKit
        >[0]["networks"],
        features: { analytics: false, email: false, socials: false, onramp: false, swaps: false, send: false },
        // Coinbase Wallet does not support Hedera; its SDK would only add a telemetry script.
        enableCoinbase: false,
        // Hedera wallets first in the list: Kabila, HashPack (WalletConnect explorer IDs).
        featuredWalletIds: [
          "c40c24b39500901a330a025938552d70def4890fffe9bd315046bd33a2ece24d",
          "a29498d225fa4b13468ff4d6cf4ae0ea4adcbd95f07ce8a843a1dee10b632f3f",
        ],
        themeVariables: { "--w3m-accent": "#8259ef", "--w3m-border-radius-master": "2px" },
      });
      return {
        appKit,
        hederaProvider,
        namespace: hwc.hederaNamespace,
        nativeNetwork: nativeNetwork as Loaded["nativeNetwork"],
      };
    })();
  }
  return appKitPromise;
}

export const HederaWalletProvider = ({ children }: { children: ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const loaded = useRef<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string>();
  const [evmAddress, setEvmAddress] = useState<`0x${string}`>();

  useEffect(() => {
    let cancelled = false;
    loadAppKit()
      .then(result => {
        if (cancelled) return;
        loaded.current = result;
        setReady(true);
        // Only the Hedera-native account is tracked here; EVM accounts come from wagmi.
        result.appKit.subscribeAccount(account => {
          // caipAddress looks like "hedera:testnet:0.0.12345".
          const id = account.isConnected ? account.caipAddress?.split(":").pop() : undefined;
          setAccountId(id);
          setEvmAddress(undefined);
          if (!id) return;
          evmAddressOf(id).then(setEvmAddress).catch(console.error);
          // A Hedera wallet approves only the native network, but AppKit starts on the EVM one and would
          // open "Switch Network" on first connect. Move it to the network the wallet approved.
          Promise.resolve(result.appKit.switchNetwork(result.nativeNetwork))
            .then(() => result.appKit.close())
            .catch(console.error);
        }, result.namespace);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready && resolvedTheme) loaded.current?.appKit.setThemeMode(resolvedTheme === "dark" ? "dark" : "light");
  }, [ready, resolvedTheme]);

  const callContract = useCallback<HederaWallet["callContract"]>(async ({ to, data, gas, payableTinybars }) => {
    const hederaProvider = loaded.current?.hederaProvider;
    const topic = hederaProvider?.session?.topic;
    const signer = topic ? hederaProvider?.nativeProvider?.getSigner(topic) : undefined;
    if (!signer) throw new Error("No Hedera wallet connected");
    const { ContractExecuteTransaction, ContractId, Hbar, HbarUnit } = await import("@hiero-ledger/sdk");
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(await contractIdOf(to)))
      .setGas(Number(gas))
      .setFunctionParameters(data);
    if (payableTinybars && payableTinybars > 0n) {
      tx.setPayableAmount(Hbar.from(payableTinybars.toString(), HbarUnit.Tinybar));
    }
    await tx.freezeWithSigner(signer);
    const response = await tx.executeWithSigner(signer);
    return waitForContractResult(response.transactionId.toString());
  }, []);

  return (
    <HederaWalletContext.Provider value={{ ready, accountId, evmAddress, callContract }}>
      {children}
    </HederaWalletContext.Provider>
  );
};

export const useHederaWallet = () => {
  const wallet = useContext(HederaWalletContext);
  if (!wallet) throw new Error("useHederaWallet must be used inside HederaWalletProvider");
  return wallet;
};
