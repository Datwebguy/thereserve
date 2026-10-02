import { eventKey, isLater, toAuditMessage, type AuditMessage } from "./events";
import type { MirrorReader } from "./mirror";
import type { Publisher } from "./publisher";
import { MAX_KEYS, type LoggerState, type StateStore } from "./state";

export interface ReserveLoggerOptions {
  /** The Reserve, as 0.0.x or an EVM address. */
  contract: string;
  /** Existing topic to post to. If unset, the stored topic is used, or a new one is created. */
  topicId?: string;
  /** How many of the topic's newest messages to read on start, to recover from a crash mid-post. */
  recoveryWindow?: number;
  log?: (line: string) => void;
}

/**
 * Posts every event The Reserve emits to an HCS topic, once.
 *
 * Idempotency:
 * - Each event is identified by txHash:logIndex. A key is recorded after its message is posted,
 *   and keys already recorded are never posted again.
 * - Logs are read from the last processed timestamp inclusive (gte), so a transaction whose logs
 *   were only partly posted is finished on the next poll without reposting the rest.
 * - If the process dies between posting and saving, the start-up recovery reads the topic's newest
 *   messages and marks their keys as posted.
 */
export class ReserveLogger {
  private state: LoggerState;
  private contractId = "";
  private topicId = "";
  private readonly log: (line: string) => void;

  constructor(
    private readonly mirror: MirrorReader,
    private readonly publisher: Publisher,
    private readonly store: StateStore,
    private readonly options: ReserveLoggerOptions,
  ) {
    this.state = store.load();
    this.log = options.log ?? (() => undefined);
  }

  get topic(): string {
    return this.topicId;
  }

  async init(): Promise<void> {
    const { contractId } = await this.mirror.resolveContract(this.options.contract);
    this.contractId = contractId;

    const topicId = this.options.topicId || this.state.topicId;
    if (topicId) {
      this.topicId = topicId;
    } else {
      this.topicId = await this.publisher.createTopic(`The Reserve audit log for ${contractId}`);
      this.log(`Created HCS topic ${this.topicId}. Set HCS_TOPIC_ID=${this.topicId} to keep using it.`);
    }
    if (this.state.topicId !== this.topicId) {
      // A different topic means a different history: start over for that topic.
      if (this.state.topicId) this.state = { lastTimestamp: "0", posted: [] };
      this.state.topicId = this.topicId;
      this.store.save(this.state);
    }

    await this.recoverFromTopic();
  }

  /** Marks events already on the topic as posted, covering a crash between post and save. */
  private async recoverFromTopic(): Promise<void> {
    const messages = await this.mirror.recentTopicMessages(this.topicId, this.options.recoveryWindow ?? 100);
    const known = new Set(this.state.posted);
    let recovered = 0;
    for (const m of messages) {
      let body: Partial<AuditMessage>;
      try {
        body = JSON.parse(m.text) as Partial<AuditMessage>;
      } catch {
        continue;
      }
      if (body.v !== 1 || typeof body.txHash !== "string" || typeof body.logIndex !== "number") continue;
      const key = eventKey(body.txHash, body.logIndex);
      if (!known.has(key)) {
        known.add(key);
        this.state.posted.push(key);
        recovered++;
        if (body.consensusTimestamp && isLater(body.consensusTimestamp, this.state.lastTimestamp)) {
          this.state.lastTimestamp = body.consensusTimestamp;
        }
      }
    }
    if (recovered > 0) {
      this.store.save(this.state);
      this.log(`Recovered ${recovered} already-posted event(s) from the topic.`);
    }
  }

  /** Reads new logs and posts each unposted event. Returns how many were posted. */
  async pollOnce(): Promise<number> {
    if (!this.topicId) throw new Error("Call init() first");
    const logs = await this.mirror.logsSince(this.contractId, this.state.lastTimestamp);
    const posted = new Set(this.state.posted);
    let count = 0;

    for (const entry of logs) {
      const key = eventKey(entry.transaction_hash, entry.index);
      if (!posted.has(key)) {
        const message = toAuditMessage(entry, this.contractId);
        if (message) {
          const { sequenceNumber } = await this.publisher.submit(this.topicId, JSON.stringify(message));
          this.log(`#${sequenceNumber} ${message.event} ${entry.transaction_hash}`);
          count++;
        }
        posted.add(key);
        this.state.posted.push(key);
      }
      if (isLater(entry.timestamp, this.state.lastTimestamp)) this.state.lastTimestamp = entry.timestamp;
      this.state.posted = this.state.posted.slice(-MAX_KEYS);
      this.store.save(this.state);
    }
    return count;
  }
}
