"use client";

import { type ReactNode } from "react";
import { type Abi, type TransactionReceipt, parseEventLogs } from "viem";
import { REASONS, hashscanTx } from "~~/utils/reserve";

export const Card = ({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={`bg-base-100 rounded-2xl shadow-md p-6 border border-base-300 ${className}`}>
    {title && <h2 className="font-bold text-lg mt-0 mb-4">{title}</h2>}
    {children}
  </div>
);

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs uppercase tracking-wider text-base-content/60">{label}</span>
    <span className="text-xl font-semibold break-all">{value}</span>
    {hint && <span className="text-xs text-base-content/60">{hint}</span>}
  </div>
);

export const NotDeployed = ({ network }: { network: string }) => (
  <Card>
    <p className="m-0">
      The Reserve is not deployed on <strong>{network}</strong>. Deploy it with{" "}
      <code className="bg-base-200 px-1 rounded">yarn deploy --network hederaTestnet</code> (or run a local fork with{" "}
      <code className="bg-base-200 px-1 rounded">yarn hardhat:chain</code> and{" "}
      <code className="bg-base-200 px-1 rounded">yarn deploy --network localhost</code>), then reload.
    </p>
  </Card>
);

export type Outcome = {
  kind: "success" | "rejected";
  title: string;
  detail?: string;
  hash: string;
  link?: string;
};

/**
 * Reads what a Reserve transaction actually did. A refused mint or withdraw does not revert (so the
 * refusal stays on-chain for the audit log), which means the wallet reports success either way.
 */
export function describeReceipt(abi: Abi, receipt: TransactionReceipt, chainId: number): Outcome {
  const events = parseEventLogs({ abi, logs: receipt.logs }) as unknown as {
    eventName: string;
    args: Record<string, unknown>;
  }[];
  const link = hashscanTx(chainId, receipt.transactionHash);
  const rejected = events.find(e => e.eventName === "MintRejected" || e.eventName === "WithdrawRejected");
  if (rejected) {
    const code = Number(rejected.args.reasonCode);
    return {
      kind: "rejected",
      title: `${rejected.eventName === "MintRejected" ? "Mint" : "Withdraw"} refused: ${REASONS[code]?.title ?? code} (code ${code})`,
      detail: REASONS[code]?.detail,
      hash: receipt.transactionHash,
      link,
    };
  }
  const names = events.map(e => e.eventName).join(", ");
  return { kind: "success", title: names ? `Done: ${names}` : "Done", hash: receipt.transactionHash, link };
}

export const OutcomeBanner = ({ outcome }: { outcome?: Outcome }) => {
  if (!outcome) return null;
  return (
    <div
      role="status"
      className={`alert ${outcome.kind === "success" ? "alert-success" : "alert-warning"} mt-4 flex flex-col items-start`}
    >
      <span className="font-semibold">{outcome.title}</span>
      {outcome.detail && <span className="text-sm">{outcome.detail}</span>}
      {outcome.link ? (
        <a href={outcome.link} target="_blank" rel="noreferrer" className="link text-sm">
          View on HashScan
        </a>
      ) : (
        <span className="text-xs break-all">Local transaction {outcome.hash}</span>
      )}
    </div>
  );
};
