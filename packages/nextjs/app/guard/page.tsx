"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { parseUnits } from "viem";
import { Card, NotDeployed, Stat } from "~~/components/reserve";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { PRICE_DECIMALS, REASONS, formatAge, formatRatio } from "~~/utils/reserve";

type Inputs = { price: string; ageMin: string; previous: string; previousAgeMin: string };

const PRESETS: { label: string; inputs: Inputs }[] = [
  { label: "Good price", inputs: { price: "0.105", ageMin: "5", previous: "0.10", previousAgeMin: "60" } },
  { label: "Stale (26 h old)", inputs: { price: "0.105", ageMin: "1560", previous: "0.10", previousAgeMin: "1600" } },
  { label: "50% jump", inputs: { price: "0.15", ageMin: "1", previous: "0.10", previousAgeMin: "30" } },
  { label: "Exactly 20% jump", inputs: { price: "0.12", ageMin: "1", previous: "0.10", previousAgeMin: "30" } },
  { label: "Zero price", inputs: { price: "0", ageMin: "1", previous: "0.10", previousAgeMin: "30" } },
];

const toPrice = (usd: string) => {
  try {
    return usd.trim() === "" ? 0n : parseUnits(usd.trim(), PRICE_DECIMALS);
  } catch {
    return undefined;
  }
};
const toSeconds = (minutes: string) => {
  const n = Number(minutes);
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 60)) : undefined;
};

const Field = ({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-sm font-medium">{label}</span>
    <div className="join w-full">
      <input
        className="input input-bordered join-item w-full"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <span className="join-item bg-base-200 px-3 flex items-center text-sm">{unit}</span>
    </div>
  </label>
);

const Guard: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: guardInfo, isLoading } = useDeployedContractInfo({ contractName: "PriceGuard" });
  const [inputs, setInputs] = useState<Inputs>(PRESETS[0].inputs);
  const set = (key: keyof Inputs) => (v: string) => setInputs(prev => ({ ...prev, [key]: v }));

  const { data: maxStaleness } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "maxStaleness" });
  const { data: maxJumpBps } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "maxJumpBps" });

  const price = toPrice(inputs.price);
  const previous = toPrice(inputs.previous);
  const age = toSeconds(inputs.ageMin);
  const previousAge = toSeconds(inputs.previousAgeMin);
  const valid = price !== undefined && previous !== undefined && age !== undefined && previousAge !== undefined;

  const { data: result, isFetching } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "simulate",
    args: [price, age, previous, previousAge],
    query: { enabled: valid },
  });
  const [ok, code] = result ?? [];

  return (
    <div className="w-full max-w-4xl mx-auto px-5 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold m-0">Price guard simulator</h1>
        <div role="note" className="alert alert-info mt-4">
          <span>
            <strong>Simulation, not live data.</strong> The prices and ages below are made up by you. They are run
            through the deployed PriceGuard&apos;s own rules (its <code>simulate</code> function) so you can see what it
            would accept or refuse. Nothing here reads or changes the real feed.
          </span>
        </div>
      </div>

      {!isLoading && !guardInfo ? (
        <NotDeployed network={targetNetwork.name} />
      ) : (
        <>
          <Card title="Guard parameters (from the deployed contract)">
            <div className="grid grid-cols-2 gap-6">
              <Stat
                label="Max price age"
                value={maxStaleness ? formatAge(maxStaleness) : "–"}
                hint="refused as stale (2)"
              />
              <Stat
                label="Max jump from last accepted price"
                value={maxJumpBps ? formatRatio(maxJumpBps) : "–"}
                hint="refused as a jump (4)"
              />
            </div>
          </Card>

          <Card title="Try a price">
            <div className="flex flex-wrap gap-2 mb-4">
              {PRESETS.map(p => (
                <button key={p.label} className="btn btn-xs btn-outline" onClick={() => setInputs(p.inputs)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="New HBAR/USD price" unit="USD" value={inputs.price} onChange={set("price")} />
              <Field label="Published this long ago" unit="min" value={inputs.ageMin} onChange={set("ageMin")} />
              <Field
                label="Last accepted price (0 for none)"
                unit="USD"
                value={inputs.previous}
                onChange={set("previous")}
              />
              <Field
                label="Last accepted price published"
                unit="min ago"
                value={inputs.previousAgeMin}
                onChange={set("previousAgeMin")}
              />
            </div>
            <p className="text-xs text-base-content/60 mt-3 mb-0">
              The jump limit only applies while the last accepted price is a recent reference: published no more than
              the max price age before the new one. The new price must also be newer than the previous one.
            </p>

            <div className="mt-6">
              {!valid ? (
                <div className="alert">Enter numbers to simulate.</div>
              ) : result === undefined || isFetching ? (
                <div className="alert">Checking…</div>
              ) : ok ? (
                <div className="alert alert-success flex flex-col items-start">
                  <span className="font-semibold">Simulated result: accepted</span>
                  <span className="text-sm">{REASONS[0].detail}</span>
                </div>
              ) : (
                <div className="alert alert-warning flex flex-col items-start">
                  <span className="font-semibold">
                    Simulated result: refused, {REASONS[Number(code)]?.title} (code {Number(code)})
                  </span>
                  <span className="text-sm">{REASONS[Number(code)]?.detail}</span>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default Guard;
