"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { Card, NotDeployed, Stat } from "~~/components/reserve";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import {
  REASONS,
  formatAge,
  formatHbar,
  formatPrice,
  formatRatio,
  formatToken,
  formatUsd,
  hashscanToken,
  isHederaChain,
} from "~~/utils/reserve";

const Home: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: reserveInfo, isLoading } = useDeployedContractInfo({ contractName: "TheReserve" });

  const { data: summary } = useScaffoldReadContract({
    contractName: "TheReserve",
    functionName: "reserveSummary",
    watch: true,
  });
  const { data: minRatioBps } = useScaffoldReadContract({ contractName: "TheReserve", functionName: "minRatioBps" });
  const { data: token } = useScaffoldReadContract({ contractName: "TheReserve", functionName: "token" });
  const { data: peek } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "peek", watch: true });
  const { data: maxStaleness } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "maxStaleness" });
  const { data: maxJumpBps } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "maxJumpBps" });

  const [collateralTinybars, collateralUsd, supply, ratioBps, lastPrice, lastPriceAge] = summary ?? [];
  const [peekOk, peekPrice, peekCode] = peek ?? [];

  return (
    <div className="flex flex-col grow items-center">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-12 px-5 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-3">The Reserve</h1>
          <p className="text-lg m-0 text-white/90">
            A token that can&apos;t be minted beyond its reserves, and can&apos;t be fooled by a bad price.
          </p>
          <p className="text-sm mt-3 mb-0 text-white/75">
            HBAR collateral valued by Chainlink HBAR/USD, checked by a price guard, issued as an HTS token only the
            contract can mint. Every action is logged to HCS.
          </p>
        </div>
      </div>

      <div className="w-full max-w-5xl px-5 py-8 flex flex-col gap-6">
        {!isLoading && !reserveInfo ? (
          <NotDeployed network={targetNetwork.name} />
        ) : (
          <>
            <Card title="Reserve">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <Stat label="HBAR held" value={formatHbar(collateralTinybars)} />
                <Stat label="Value" value={formatUsd(collateralUsd)} hint="at the last accepted price" />
                <Stat
                  label="Tokens issued"
                  value={formatToken(supply)}
                  hint={
                    token && isHederaChain(targetNetwork.id) ? (
                      <a
                        className="link"
                        href={hashscanToken(targetNetwork.id, token)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Token on HashScan
                      </a>
                    ) : undefined
                  }
                />
                <Stat
                  label="Overall ratio"
                  value={formatRatio(ratioBps)}
                  hint={`minimum ${formatRatio(minRatioBps)}`}
                />
                <Stat label="Last accepted price" value={formatPrice(lastPrice)} hint="Chainlink HBAR/USD" />
                <Stat
                  label="Price age"
                  value={lastPrice ? formatAge(lastPriceAge) : "–"}
                  hint="since that price was published"
                />
              </div>
            </Card>

            <Card title="Price guard">
              <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                <div>
                  {peek === undefined ? (
                    <span className="badge badge-ghost">Reading feed…</span>
                  ) : peekOk ? (
                    <span className="badge badge-success badge-lg">Healthy</span>
                  ) : (
                    <span className="badge badge-warning badge-lg">
                      Refusing: {REASONS[Number(peekCode)]?.title} (code {Number(peekCode)})
                    </span>
                  )}
                  <p className="text-sm text-base-content/70 mt-2 mb-0">
                    What the guard says about the feed&apos;s current answer ({formatPrice(peekPrice)}), read live from
                    the chain. Mints and withdrawals with debt only go through when it is healthy; burns never need a
                    price.
                  </p>
                </div>
                <div className="flex gap-8 text-sm shrink-0 whitespace-nowrap">
                  <Stat label="Max age" value={maxStaleness ? formatAge(maxStaleness) : "–"} />
                  <Stat label="Max jump" value={maxJumpBps ? formatRatio(maxJumpBps) : "–"} />
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card title="Vault">
                <p className="text-sm mt-0">Deposit HBAR, mint within the ratio, burn and withdraw.</p>
                <Link href="/vault" className="btn btn-primary btn-sm">
                  Open vault
                </Link>
              </Card>
              <Card title="Audit log">
                <p className="text-sm mt-0">Every mint, refusal, burn and withdrawal, as posted to HCS.</p>
                <Link href="/log" className="btn btn-primary btn-sm">
                  Open log
                </Link>
              </Card>
              <Card title="Guard simulator">
                <p className="text-sm mt-0">Try prices against the guard&apos;s rules. A simulation, not live data.</p>
                <Link href="/guard" className="btn btn-primary btn-sm">
                  Open simulator
                </Link>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Home;
