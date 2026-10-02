"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextPage } from "next";
import { hedera, hederaTestnet } from "viem/chains";
import { Card } from "~~/components/reserve";
import {
  formatHbar,
  formatPrice,
  formatToken,
  hashscanTopic,
  hashscanTx,
  mirrorNodeUrl,
  reasonTitle,
} from "~~/utils/reserve";

/** One HCS message as posted by packages/logger (format v1). */
type AuditMessage = {
  v: 1;
  event: string;
  account: string | null;
  amount: string | null;
  unit: "tinybar" | "token" | null;
  reasonCode: number | null;
  price: string | null;
  txHash: string;
  logIndex: number;
  consensusTimestamp: string;
  contract: string;
};

type Row = { sequence: number; postedAt: string; body?: AuditMessage; raw: string };

const TOPIC_ID = process.env.NEXT_PUBLIC_HCS_TOPIC_ID;
// The topic lives on a real Hedera network even when the app targets a local fork.
const TOPIC_CHAIN_ID = process.env.NEXT_PUBLIC_HCS_NETWORK === "mainnet" ? hedera.id : hederaTestnet.id;

const badge = (event?: string) => {
  if (!event) return "badge-ghost";
  if (event.endsWith("Rejected")) return "badge-warning";
  if (event === "Minted" || event === "Deposited") return "badge-success";
  return "badge-info";
};

const amountOf = (m: AuditMessage) => {
  if (m.amount === null) return "–";
  return m.unit === "tinybar" ? formatHbar(BigInt(m.amount)) : formatToken(BigInt(m.amount));
};

const toDate = (consensus: string) => new Date(Number(consensus.split(".")[0]) * 1000).toLocaleString();

const Log: NextPage = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const base = mirrorNodeUrl(TOPIC_CHAIN_ID);

  const load = useCallback(
    async (path: string, append: boolean) => {
      setLoading(true);
      try {
        const res = await fetch(`${base}${path}`);
        if (!res.ok) throw new Error(`Mirror Node returned ${res.status}`);
        const body = (await res.json()) as {
          messages: { sequence_number: number; consensus_timestamp: string; message: string }[];
          links?: { next?: string | null };
        };
        const page = body.messages.map(m => {
          const raw = atob(m.message);
          let parsed: AuditMessage | undefined;
          try {
            const json = JSON.parse(raw);
            if (json?.v === 1) parsed = json;
          } catch {
            // Not one of ours; shown raw.
          }
          return { sequence: m.sequence_number, postedAt: m.consensus_timestamp, body: parsed, raw };
        });
        setRows(prev => (append ? [...prev, ...page] : page));
        setNext(body.links?.next ?? null);
        setError(undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    if (!TOPIC_ID) return;
    const first = `/api/v1/topics/${TOPIC_ID}/messages?order=desc&limit=25`;
    load(first, false);
    const timer = setInterval(() => load(first, false), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="w-full max-w-6xl mx-auto px-5 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold m-0">Audit log</h1>
        <p className="text-sm text-base-content/70 mt-2 mb-0">
          Every event The Reserve emits, posted to a Hedera Consensus Service topic by{" "}
          <code className="bg-base-200 px-1 rounded">packages/logger</code> and read back here from the Mirror Node,
          newest first.
          {TOPIC_ID && (
            <>
              {" "}
              Topic{" "}
              <a className="link" href={hashscanTopic(TOPIC_CHAIN_ID, TOPIC_ID)} target="_blank" rel="noreferrer">
                {TOPIC_ID}
              </a>
              .
            </>
          )}
        </p>
      </div>

      {!TOPIC_ID ? (
        <Card>
          <p className="m-0">
            No topic configured. Run the logger (<code className="bg-base-200 px-1 rounded">yarn logger</code>), which
            creates a topic on first start, then set{" "}
            <code className="bg-base-200 px-1 rounded">NEXT_PUBLIC_HCS_TOPIC_ID</code> in{" "}
            <code className="bg-base-200 px-1 rounded">packages/nextjs/.env.local</code> and restart the app.
          </p>
        </Card>
      ) : (
        <Card>
          {error && <div className="alert alert-error mb-4">{error}</div>}
          {rows.length === 0 && !loading && !error && <p className="m-0">No messages on this topic yet.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Event</th>
                    <th>Account</th>
                    <th>Amount</th>
                    <th>Reason</th>
                    <th>Price</th>
                    <th>When</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r =>
                    r.body ? (
                      <tr key={r.sequence}>
                        <td>{r.sequence}</td>
                        <td>
                          <span className={`badge badge-sm ${badge(r.body.event)}`}>{r.body.event}</span>
                        </td>
                        <td className="font-mono text-xs">
                          {r.body.account ? `${r.body.account.slice(0, 6)}…${r.body.account.slice(-4)}` : "–"}
                        </td>
                        <td>{amountOf(r.body)}</td>
                        <td>
                          {r.body.reasonCode !== null ? `${r.body.reasonCode}: ${reasonTitle(r.body.reasonCode)}` : "–"}
                        </td>
                        <td>{r.body.price ? formatPrice(BigInt(r.body.price)) : "–"}</td>
                        <td className="text-xs whitespace-nowrap">{toDate(r.body.consensusTimestamp)}</td>
                        <td>
                          <a
                            className="link text-xs"
                            href={hashscanTx(TOPIC_CHAIN_ID, r.body.txHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            HashScan
                          </a>
                        </td>
                      </tr>
                    ) : (
                      <tr key={r.sequence}>
                        <td>{r.sequence}</td>
                        <td colSpan={6} className="text-xs font-mono break-all">
                          {r.raw}
                        </td>
                        <td className="text-xs whitespace-nowrap">{toDate(r.postedAt)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          {next && (
            <button className="btn btn-sm mt-4" disabled={loading} onClick={() => load(next, true)}>
              Load older
            </button>
          )}
        </Card>
      )}
    </div>
  );
};

export default Log;
