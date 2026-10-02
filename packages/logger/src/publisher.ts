import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  type AccountId,
} from "@hiero-ledger/sdk";

export interface Publisher {
  /** Creates a topic only this publisher can post to. Returns its ID (0.0.x). */
  createTopic(memo: string): Promise<string>;
  /** Posts one message. Resolves once the message has reached consensus. */
  submit(topicId: string, message: string): Promise<{ sequenceNumber: number; transactionId: string }>;
}

/** Posts to HCS with the logger's own operator account. That key can only post to the topic. */
export class HcsPublisher implements Publisher {
  private readonly client: Client;
  private readonly key: PrivateKey;

  constructor(network: "testnet" | "mainnet", operatorId: string | AccountId, operatorKey: string) {
    this.key = parsePrivateKey(operatorKey);
    this.client = (network === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(operatorId, this.key);
  }

  async createTopic(memo: string): Promise<string> {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setSubmitKey(this.key.publicKey)
      .execute(this.client);
    const receipt = await tx.getReceipt(this.client);
    if (!receipt.topicId) throw new Error("Topic creation returned no topic ID");
    return receipt.topicId.toString();
  }

  async submit(topicId: string, message: string) {
    const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(this.client);
    const receipt = await tx.getReceipt(this.client);
    return { sequenceNumber: Number(receipt.topicSequenceNumber ?? 0), transactionId: tx.transactionId.toString() };
  }

  close() {
    this.client.close();
  }
}

/** Accepts DER-encoded or 0x-prefixed raw ECDSA/ED25519 keys, as the Hedera portal shows them. */
export function parsePrivateKey(key: string): PrivateKey {
  const k = key.trim();
  if (k.startsWith("302")) return PrivateKey.fromStringDer(k);
  if (k.startsWith("0x")) return PrivateKey.fromStringECDSA(k);
  return PrivateKey.fromString(k);
}
