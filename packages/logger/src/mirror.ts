import type { MirrorLog } from "./events";

/** A message already on the HCS topic, decoded. */
export interface TopicMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  /** Decoded UTF-8 body. */
  text: string;
}

export interface MirrorReader {
  /** Resolves a contract given as 0.0.x or an EVM address to both forms. */
  resolveContract(idOrAddress: string): Promise<{ contractId: string; evmAddress: string }>;
  /** All of a contract's logs at or after `fromTimestamp`, oldest first. */
  logsSince(contractId: string, fromTimestamp: string): Promise<MirrorLog[]>;
  /** The newest `limit` messages on a topic, newest first. */
  recentTopicMessages(topicId: string, limit: number): Promise<TopicMessage[]>;
}

type Fetch = typeof fetch;

/** Reads the Hedera Mirror Node REST API. */
export class MirrorNodeClient implements MirrorReader {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Mirror Node ${res.status} for ${url}`);
    return (await res.json()) as T;
  }

  async resolveContract(idOrAddress: string) {
    const body = await this.get<{ contract_id: string; evm_address: string }>(`/api/v1/contracts/${idOrAddress}`);
    return { contractId: body.contract_id, evmAddress: body.evm_address };
  }

  async logsSince(contractId: string, fromTimestamp: string): Promise<MirrorLog[]> {
    const logs: MirrorLog[] = [];
    let next: string | null =
      `/api/v1/contracts/${contractId}/results/logs?order=asc&limit=100&timestamp=gte:${fromTimestamp}`;
    while (next) {
      const page: { logs: MirrorLog[]; links?: { next?: string | null } } = await this.get(next);
      logs.push(...page.logs);
      next = page.links?.next ?? null;
    }
    return logs;
  }

  async recentTopicMessages(topicId: string, limit: number): Promise<TopicMessage[]> {
    const body = await this.get<{
      messages: { sequence_number: number; consensus_timestamp: string; message: string }[];
    }>(`/api/v1/topics/${topicId}/messages?order=desc&limit=${Math.min(limit, 100)}`);
    return body.messages.map(m => ({
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      text: Buffer.from(m.message, "base64").toString("utf8"),
    }));
  }
}
