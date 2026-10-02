import { Interface, type LogDescription } from "ethers";

/**
 * The Reserve's events, as declared in packages/hardhat/contracts/TheReserve.sol.
 * test/events.test.ts checks these against the compiled ABI.
 */
export const RESERVE_EVENTS = [
  "event Deposited(address indexed account, uint256 amountTinybars, uint256 collateralTinybars)",
  "event Minted(address indexed account, uint256 amount, uint256 price, uint256 debt)",
  "event MintRejected(address indexed account, uint256 amount, uint8 reasonCode, uint256 price)",
  "event Burned(address indexed account, uint256 amount, uint256 debt)",
  "event Withdrawn(address indexed account, uint256 amountTinybars, uint256 price, uint256 collateralTinybars)",
  "event WithdrawRejected(address indexed account, uint256 amountTinybars, uint8 reasonCode, uint256 price)",
  "event TokenCreated(address indexed token, string name, string symbol)",
] as const;

export const reserveInterface = new Interface(RESERVE_EVENTS as unknown as string[]);

/** A contract log as returned by the Mirror Node's /contracts/{id}/results/logs endpoint. */
export interface MirrorLog {
  address: string;
  contract_id: string;
  data: string;
  index: number;
  topics: string[];
  timestamp: string;
  transaction_hash: string;
}

/** One HCS message per contract event. Format version 1. */
export interface AuditMessage {
  v: 1;
  event: string;
  account: string | null;
  /** Amount in `unit`s, as a decimal string. */
  amount: string | null;
  unit: "tinybar" | "token" | null;
  reasonCode: number | null;
  /** HBAR/USD with 8 decimals, as a decimal string; null when the event carries no price. */
  price: string | null;
  txHash: string;
  logIndex: number;
  consensusTimestamp: string;
  contract: string;
}

/** Stable identity of an event: a transaction can emit more than one log. */
export function eventKey(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}

function parse(log: MirrorLog): LogDescription | null {
  try {
    return reserveInterface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    return null;
  }
}

/** Turns a Mirror Node log into the audit message, or null if it is not one of The Reserve's events. */
export function toAuditMessage(log: MirrorLog, contract: string): AuditMessage | null {
  const parsed = parse(log);
  if (!parsed) return null;
  const a = parsed.args;
  const base = {
    v: 1 as const,
    event: parsed.name,
    txHash: log.transaction_hash,
    logIndex: log.index,
    consensusTimestamp: log.timestamp,
    contract,
  };
  const str = (x: unknown) => (x === undefined || x === null ? null : String(x));

  switch (parsed.name) {
    case "Deposited":
      return {
        ...base,
        account: a.account,
        amount: str(a.amountTinybars),
        unit: "tinybar",
        reasonCode: null,
        price: null,
      };
    case "Minted":
      return {
        ...base,
        account: a.account,
        amount: str(a.amount),
        unit: "token",
        reasonCode: null,
        price: str(a.price),
      };
    case "MintRejected":
      return {
        ...base,
        account: a.account,
        amount: str(a.amount),
        unit: "token",
        reasonCode: Number(a.reasonCode),
        price: a.price === 0n ? null : str(a.price),
      };
    case "Burned":
      return { ...base, account: a.account, amount: str(a.amount), unit: "token", reasonCode: null, price: null };
    case "Withdrawn":
      return {
        ...base,
        account: a.account,
        amount: str(a.amountTinybars),
        unit: "tinybar",
        reasonCode: null,
        price: a.price === 0n ? null : str(a.price),
      };
    case "WithdrawRejected":
      return {
        ...base,
        account: a.account,
        amount: str(a.amountTinybars),
        unit: "tinybar",
        reasonCode: Number(a.reasonCode),
        price: a.price === 0n ? null : str(a.price),
      };
    case "TokenCreated":
      return { ...base, account: a.token, amount: null, unit: null, reasonCode: null, price: null };
    default:
      return null;
  }
}

/** Compares Hedera consensus timestamps ("seconds.nanos"). Returns true if a is later than b. */
export function isLater(a: string, b: string): boolean {
  const toNanos = (t: string) => {
    const [s, n = "0"] = t.split(".");
    return BigInt(s) * 1_000_000_000n + BigInt(n.padEnd(9, "0").slice(0, 9));
  };
  return toNanos(a) > toNanos(b);
}
