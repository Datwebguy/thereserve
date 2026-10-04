"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DAppConnector } from "@hashgraph/hedera-wallet-connect/dist/lib/dapp";
import { hedera } from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";
import { type MirrorContractResult, entityIdFromLongZero, toMirrorTransactionId } from "~~/utils/hederaWallet";
import { mirrorNodeUrl } from "~~/utils/reserve";

/**
 * Connects Hedera-native wallets (Kabila, HashPack, Blade and others) through Hedera's WalletConnect
 * namespace. Unlike the EVM (EIP-155) connection, this works with any Hedera account, including ECDSA
 * accounts without an EVM alias and ED25519 accounts.
 */

type HederaWallet = {
  /** The connected account ("0.0.N"), if any. */
  accountId?: string;
  /** The account's EVM address, as the contracts see it (msg.sender). */
  evmAddress?: `0x${string}`;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Sends a contract call signed by the connected wallet and waits for the Mirror Node to report it.
   * `payableTinybars` is sent as msg.value (tinybars on Hedera).
   */
  callContract: (args: {
    to: string;
    data: Uint8Array;
    gas: bigint;
    payableTinybars?: bigint;
  }) => Promise<MirrorContractResult>;
};

const HederaWalletContext = createContext<HederaWallet | null>(null);

// Remembers that this browser had a Hedera wallet session, so the connector is only started on load
// when there is a session to restore.
const SESSION_FLAG = "reserve.hederaWallet";

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

export const HederaWalletProvider = ({ children }: { children: ReactNode }) => {
  const connectorRef = useRef<Promise<DAppConnector> | null>(null);
  const [accountId, setAccountId] = useState<string>();
  const [evmAddress, setEvmAddress] = useState<`0x${string}`>();
  const [connecting, setConnecting] = useState(false);

  const adopt = useCallback(async (connector: DAppConnector) => {
    const signer = connector.signers[0];
    if (!signer) {
      setAccountId(undefined);
      setEvmAddress(undefined);
      return;
    }
    const id = signer.getAccountId().toString();
    setAccountId(id);
    setEvmAddress(await evmAddressOf(id));
    try {
      localStorage.setItem(SESSION_FLAG, "1");
    } catch {}
  }, []);

  const getConnector = useCallback(() => {
    if (!connectorRef.current) {
      connectorRef.current = (async () => {
        // Loaded on demand: the connector and the Hedera SDK only reach visitors who use them.
        const [{ DAppConnector }, shared, { LedgerId }] = await Promise.all([
          import("@hashgraph/hedera-wallet-connect/dist/lib/dapp"),
          import("@hashgraph/hedera-wallet-connect/dist/lib/shared"),
          import("@hiero-ledger/sdk"),
        ]);
        const origin = window.location.origin;
        const connector = new DAppConnector(
          {
            name: "The Reserve",
            description: "An HTS token that can't be minted beyond its HBAR reserves.",
            url: origin,
            icons: [`${origin}/icon-512.png`],
          },
          isMainnet ? LedgerId.MAINNET : LedgerId.TESTNET,
          scaffoldConfig.walletConnectProjectId,
          Object.values(shared.HederaJsonRpcMethod),
          [shared.HederaSessionEvent.ChainChanged, shared.HederaSessionEvent.AccountsChanged],
          [isMainnet ? shared.HederaChainId.Mainnet : shared.HederaChainId.Testnet],
        );
        await connector.init({ logger: "error" });
        connector.walletConnectClient?.on("session_delete", () => {
          setAccountId(undefined);
          setEvmAddress(undefined);
          try {
            localStorage.removeItem(SESSION_FLAG);
          } catch {}
        });
        return connector;
      })();
    }
    return connectorRef.current;
  }, []);

  // Restore a session from an earlier visit.
  useEffect(() => {
    let had = false;
    try {
      had = localStorage.getItem(SESSION_FLAG) === "1";
    } catch {}
    if (had) getConnector().then(adopt).catch(console.error);
  }, [adopt, getConnector]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const connector = await getConnector();
      await connector.openModal();
      await adopt(connector);
    } finally {
      setConnecting(false);
    }
  }, [adopt, getConnector]);

  const disconnect = useCallback(async () => {
    const connector = await getConnector();
    await connector.disconnectAll().catch(() => undefined);
    setAccountId(undefined);
    setEvmAddress(undefined);
    try {
      localStorage.removeItem(SESSION_FLAG);
    } catch {}
  }, [getConnector]);

  const callContract = useCallback<HederaWallet["callContract"]>(
    async ({ to, data, gas, payableTinybars }) => {
      const connector = await getConnector();
      const signer = connector.signers[0];
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
    },
    [getConnector],
  );

  return (
    <HederaWalletContext.Provider value={{ accountId, evmAddress, connecting, connect, disconnect, callContract }}>
      {children}
    </HederaWalletContext.Provider>
  );
};

export const useHederaWallet = () => {
  const wallet = useContext(HederaWalletContext);
  if (!wallet) throw new Error("useHederaWallet must be used inside HederaWalletProvider");
  return wallet;
};
