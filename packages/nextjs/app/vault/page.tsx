"use client";

import { useState } from "react";
import type { NextPage } from "next";
import type { Abi, TransactionReceipt } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import {
  Card,
  NotDeployed,
  type Outcome,
  OutcomeBanner,
  Stat,
  describeLogs,
  describeReceipt,
} from "~~/components/reserve";
import {
  useDeployedContractInfo,
  useHederaAccountId,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
  useTransactor,
} from "~~/hooks/scaffold-hbar";
import { useReserveAccount } from "~~/hooks/useReserveAccount";
import { useHederaWallet } from "~~/services/hedera/HederaWalletProvider";
import { type MirrorContractResult, callData, mirrorLogsToViem } from "~~/utils/hederaWallet";
import {
  formatHbar,
  formatPrice,
  formatRatio,
  formatToken,
  hbarToValue,
  htsTokenAbi,
  isHederaChain,
  maxMintable,
  parseHbarToTinybars,
  parseToken,
} from "~~/utils/reserve";
import { notification } from "~~/utils/scaffold-hbar";

/**
 * Explicit gas limits. The relay's estimates for calls into the HTS system contract can come in low,
 * because that gas follows a USD price plus a surcharge. Unused gas is refunded, so these err on the high side.
 */
const GAS = {
  deposit: 200_000n,
  withdraw: 300_000n,
  mint: 800_000n,
  burn: 800_000n,
  associate: 800_000n,
  approve: 800_000n,
};

const AmountForm = ({
  label,
  unit,
  button,
  disabled,
  busy,
  onSubmit,
  hint,
}: {
  label: string;
  unit: string;
  button: string;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (value: string) => Promise<void>;
  hint?: React.ReactNode;
}) => {
  const [value, setValue] = useState("");
  const valid = /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async e => {
        e.preventDefault();
        if (!valid) return;
        await onSubmit(value);
        setValue("");
      }}
    >
      <label className="text-sm font-medium">{label}</label>
      <div className="join w-full">
        <input
          className="input input-bordered join-item w-full"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={e => setValue(e.target.value.trim())}
        />
        <span className="join-item bg-base-200 px-3 flex items-center text-sm">{unit}</span>
        <button className="btn btn-primary join-item" type="submit" disabled={disabled || busy || !valid}>
          {busy ? <span className="loading loading-spinner loading-xs" /> : button}
        </button>
      </div>
      {hint && <span className="text-xs text-base-content/60">{hint}</span>}
    </form>
  );
};

const Vault: NextPage = () => {
  const { address, kind } = useReserveAccount();
  const hedera = useHederaWallet();
  const { targetNetwork } = useTargetNetwork();
  const chainId = targetNetwork.id;
  const { data: reserveInfo, isLoading } = useDeployedContractInfo({ contractName: "TheReserve" });
  const [outcome, setOutcome] = useState<Outcome>();
  const [busy, setBusy] = useState<string>();

  const read = { contractName: "TheReserve" as const, watch: true };
  const { data: token } = useScaffoldReadContract({ ...read, functionName: "token" });
  const { data: minRatioBps } = useScaffoldReadContract({ ...read, functionName: "minRatioBps" });
  const { data: collateral } = useScaffoldReadContract({ ...read, functionName: "collateral", args: [address] });
  const { data: debt } = useScaffoldReadContract({ ...read, functionName: "debt", args: [address] });
  const { data: ratio } = useScaffoldReadContract({ ...read, functionName: "ratioOf", args: [address] });
  const { data: peek } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "peek", watch: true });

  // On Hedera an EVM address only becomes an account once it receives HBAR. The relay rejects calls
  // sent from an address with no account, so look it up on the Mirror Node before calling isAssociated.
  const onHedera = isHederaChain(chainId);
  const {
    accountId,
    isLoading: accountLoading,
    lookupFailed,
  } = useHederaAccountId(onHedera ? address : undefined, chainId);
  const noHederaAccount = onHedera && !!address && !accountLoading && !lookupFailed && accountId === null;
  const accountReady = !onHedera || !!accountId;

  const tokenAddress = token && token !== "0x0000000000000000000000000000000000000000" ? token : undefined;
  const tokenRead = { address: tokenAddress, abi: htsTokenAbi, query: { enabled: !!tokenAddress && !!address } };
  // HIP-719 isAssociated() answers for msg.sender, so the call is made from the user's address.
  const { data: associated, refetch: refetchAssociated } = useReadContract({
    ...tokenRead,
    functionName: "isAssociated",
    account: address,
    query: { enabled: tokenRead.query.enabled && accountReady },
  });
  const { data: balance, refetch: refetchBalance } = useReadContract({
    ...tokenRead,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });
  const { data: symbol } = useReadContract({ ...tokenRead, functionName: "symbol" });

  const { writeContractAsync: writeReserve } = useScaffoldWriteContract({ contractName: "TheReserve" });
  const { writeContractAsync: writeToken } = useWriteContract();
  const transactor = useTransactor();

  const [feedOk, feedPrice] = peek ?? [];
  const preview =
    feedOk && collateral !== undefined && debt !== undefined && minRatioBps
      ? maxMintable(collateral, debt, feedPrice ?? 0n, minRatioBps)
      : undefined;

  const done = (receipt: TransactionReceipt) => {
    if (reserveInfo) setOutcome(describeReceipt(reserveInfo.abi as Abi, receipt, chainId));
    refetchBalance();
    refetchAssociated();
  };

  /**
   * Hedera-native wallets (Kabila, HashPack) sign Hedera transactions rather than EVM ones, so their
   * calls go out as ContractExecuteTransactions: same contract, same function, same arguments.
   */
  const sendHedera = async ({
    on,
    functionName,
    args = [],
    hbar,
    gas,
  }: {
    on: "reserve" | "token";
    functionName: string;
    args?: readonly unknown[];
    hbar?: string;
    gas: bigint;
  }) => {
    const abi = (on === "reserve" ? reserveInfo!.abi : htsTokenAbi) as Abi;
    const to = on === "reserve" ? reserveInfo!.address : tokenAddress!;
    const result = await hedera.callContract({
      to,
      data: callData(abi, functionName, args),
      gas,
      payableTinybars: hbar ? parseHbarToTinybars(hbar) : undefined,
    });
    if (result.result !== "SUCCESS")
      throw new Error(`${functionName} failed: ${result.error_message || result.result}`);
    return result;
  };

  const doneHedera = (result: MirrorContractResult) => {
    if (reserveInfo) {
      setOutcome(describeLogs(reserveInfo.abi as Abi, mirrorLogsToViem(result.logs), result.hash, chainId));
    }
    refetchBalance();
    refetchAssociated();
  };

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setOutcome(undefined);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      // EVM wallet errors are already shown by the transactor; Hedera wallet errors are shown here.
      if (kind === "hedera") notification.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (!isLoading && !reserveInfo) {
    return (
      <div className="w-full max-w-5xl mx-auto px-5 py-8">
        <NotDeployed network={targetNetwork.name} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-5 py-8 flex flex-col gap-6">
      <h1 className="text-3xl font-bold m-0">Vault</h1>
      {!address ? (
        <Card>
          <p className="m-0">Connect a wallet to see your position.</p>
        </Card>
      ) : (
        <>
          <Card title="Your position">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Stat label="Collateral" value={formatHbar(collateral)} />
              <Stat label="Debt" value={formatToken(debt, symbol)} />
              <Stat label="Ratio" value={formatRatio(ratio)} hint={`minimum ${formatRatio(minRatioBps)}`} />
              <Stat label="Wallet balance" value={formatToken(balance, symbol)} />
            </div>
            <div className="divider my-4" />
            <Stat
              label="You can mint up to"
              value={feedOk ? formatToken(preview, symbol) : "Paused"}
              hint={
                feedOk
                  ? `at the feed's current price ${formatPrice(feedPrice)}, checked again by the guard when you mint`
                  : "the price guard is refusing the current price, so minting is paused; burning still works"
              }
            />
          </Card>

          <Card title="1. Associate the token">
            {noHederaAccount ? (
              <p className="m-0 text-sm">
                <span className="badge badge-warning mr-2">No Hedera account</span>
                No Hedera account was found for {address}. An EVM address becomes a Hedera account when it first
                receives HBAR, so send it some HBAR (on testnet, from the faucet linked below), then reload this page to
                associate the token and deposit.
              </p>
            ) : !onHedera ? (
              <p className="m-0 text-sm">
                Not needed on the local fork: Hedera&apos;s HTS emulation does not model token association. On testnet
                and mainnet an account must associate the token before receiving it, and this card offers the button.
              </p>
            ) : associated ? (
              <p className="m-0 text-sm">
                <span className="badge badge-success mr-2">Associated</span>
                Your account can receive {symbol ?? "the token"}.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm">
                  On Hedera an account must associate an HTS token before it can receive it, or the transfer fails with{" "}
                  <code>TOKEN_NOT_ASSOCIATED_TO_ACCOUNT</code>. Accounts with free automatic-association slots can skip
                  this, but associating first is always safe.
                </p>
                <button
                  className="btn btn-primary btn-sm w-fit"
                  disabled={!tokenAddress || !!busy}
                  onClick={() =>
                    run("associate", async () =>
                      kind === "hedera"
                        ? doneHedera(await sendHedera({ on: "token", functionName: "associate", gas: GAS.associate }))
                        : transactor(
                            () =>
                              writeToken({
                                address: tokenAddress!,
                                abi: htsTokenAbi,
                                functionName: "associate",
                                gas: GAS.associate,
                              }),
                            { onBlockConfirmation: done },
                          ),
                    )
                  }
                >
                  {busy === "associate" ? <span className="loading loading-spinner loading-xs" /> : "Associate token"}
                </button>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card title="2. Deposit HBAR">
              <AmountForm
                label="Amount"
                unit="HBAR"
                button="Deposit"
                busy={busy === "deposit"}
                disabled={!!busy}
                onSubmit={v =>
                  run("deposit", async () =>
                    kind === "hedera"
                      ? doneHedera(
                          await sendHedera({ on: "reserve", functionName: "deposit", hbar: v, gas: GAS.deposit }),
                        )
                      : writeReserve(
                          { functionName: "deposit", value: hbarToValue(v, chainId), gas: GAS.deposit },
                          { onBlockConfirmation: done },
                        ),
                  )
                }
              />
            </Card>

            <Card title="3. Mint">
              <AmountForm
                label="Amount"
                unit={symbol ?? "tokens"}
                button="Mint"
                busy={busy === "mint"}
                disabled={!!busy || !tokenAddress}
                hint="If a rule blocks it, the transaction still succeeds but mints nothing, and the refusal is logged."
                onSubmit={v =>
                  run("mint", async () =>
                    kind === "hedera"
                      ? doneHedera(
                          await sendHedera({
                            on: "reserve",
                            functionName: "mint",
                            args: [parseToken(v)],
                            gas: GAS.mint,
                          }),
                        )
                      : writeReserve(
                          { functionName: "mint", args: [parseToken(v)], gas: GAS.mint },
                          { onBlockConfirmation: done },
                        ),
                  )
                }
              />
            </Card>

            <Card title="4. Burn">
              <AmountForm
                label="Amount"
                unit={symbol ?? "tokens"}
                button="Approve & burn"
                busy={busy === "burn"}
                disabled={!!busy || !tokenAddress}
                hint="Two transactions: approve The Reserve to take the tokens, then burn. Never needs a price."
                onSubmit={v =>
                  run("burn", async () => {
                    const amount = parseToken(v);
                    if (kind === "hedera") {
                      await sendHedera({
                        on: "token",
                        functionName: "approve",
                        args: [reserveInfo!.address, amount],
                        gas: GAS.approve,
                      });
                      doneHedera(
                        await sendHedera({ on: "reserve", functionName: "burn", args: [amount], gas: GAS.burn }),
                      );
                      return;
                    }
                    await transactor(() =>
                      writeToken({
                        address: tokenAddress!,
                        abi: htsTokenAbi,
                        functionName: "approve",
                        args: [reserveInfo!.address, amount],
                        gas: GAS.approve,
                      }),
                    );
                    await writeReserve(
                      { functionName: "burn", args: [amount], gas: GAS.burn },
                      { onBlockConfirmation: done },
                    );
                  })
                }
              />
            </Card>

            <Card title="5. Withdraw HBAR">
              <AmountForm
                label="Amount"
                unit="HBAR"
                button="Withdraw"
                busy={busy === "withdraw"}
                disabled={!!busy}
                hint="With no debt this always works. With debt, you must stay above the minimum ratio."
                onSubmit={v =>
                  run("withdraw", async () =>
                    kind === "hedera"
                      ? doneHedera(
                          await sendHedera({
                            on: "reserve",
                            functionName: "withdraw",
                            args: [parseHbarToTinybars(v)],
                            gas: GAS.withdraw,
                          }),
                        )
                      : writeReserve(
                          { functionName: "withdraw", args: [parseHbarToTinybars(v)], gas: GAS.withdraw },
                          { onBlockConfirmation: done },
                        ),
                  )
                }
              />
            </Card>
          </div>

          <OutcomeBanner outcome={outcome} />
        </>
      )}
    </div>
  );
};

export default Vault;
