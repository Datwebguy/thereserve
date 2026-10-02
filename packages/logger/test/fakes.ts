import { Interface } from "ethers";
import { RESERVE_EVENTS, type MirrorLog } from "../src/events";
import type { MirrorReader, TopicMessage } from "../src/mirror";
import type { Publisher } from "../src/publisher";

export const CONTRACT_ID = "0.0.5005";
export const CONTRACT_EVM = "0x000000000000000000000000000000000000138d";
export const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const iface = new Interface(RESERVE_EVENTS as unknown as string[]);

/** Builds a Mirror Node log for one of The Reserve's events. */
export function makeLog(event: string, args: unknown[], txHash: string, index: number, timestamp: string): MirrorLog {
  const fragment = iface.getEvent(event)!;
  const { data, topics } = iface.encodeEventLog(fragment, args);
  return {
    address: CONTRACT_EVM,
    contract_id: CONTRACT_ID,
    data,
    index,
    topics,
    timestamp,
    transaction_hash: txHash,
  };
}

export const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** Publisher that records messages; the same list backs FakeMirror's topic, like HCS + Mirror Node. */
export class FakePublisher implements Publisher {
  messages: string[] = [];
  topicsCreated = 0;
  /** If set, submit() posts the message and then throws, like a crash before the state is saved. */
  crashAfterNext = false;

  async createTopic(): Promise<string> {
    this.topicsCreated++;
    return "0.0.7007";
  }

  async submit(_topicId: string, message: string) {
    this.messages.push(message);
    if (this.crashAfterNext) {
      this.crashAfterNext = false;
      throw new Error("process killed");
    }
    return { sequenceNumber: this.messages.length, transactionId: `0.0.2@${this.messages.length}` };
  }

  parsed() {
    return this.messages.map(m => JSON.parse(m));
  }
}

export class FakeMirror implements MirrorReader {
  logs: MirrorLog[] = [];
  queries: string[] = [];

  constructor(private readonly publisher: FakePublisher) {}

  async resolveContract() {
    return { contractId: CONTRACT_ID, evmAddress: CONTRACT_EVM };
  }

  async logsSince(_contractId: string, fromTimestamp: string) {
    this.queries.push(fromTimestamp);
    const toNanos = (t: string) => BigInt(t.replace(".", ""));
    return this.logs.filter(l => toNanos(l.timestamp) >= toNanos(fromTimestamp));
  }

  async recentTopicMessages(_topicId: string, limit: number): Promise<TopicMessage[]> {
    return this.publisher.messages
      .map((text, i) => ({ sequenceNumber: i + 1, consensusTimestamp: `${1_800_000_000 + i}.000000000`, text }))
      .reverse()
      .slice(0, limit);
  }
}
