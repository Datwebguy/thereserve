export interface LoggerConfig {
  network: "testnet" | "mainnet";
  mirrorNodeUrl: string;
  contract: string;
  operatorId: string;
  operatorKey: string;
  topicId?: string;
  pollIntervalMs: number;
  stateFile: string;
}

const MIRROR: Record<LoggerConfig["network"], string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};

/** Reads the logger's settings from the environment. Throws with every missing variable named. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
  const network = (env.HEDERA_NETWORK || "testnet").toLowerCase();
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`HEDERA_NETWORK must be testnet or mainnet, got "${network}"`);
  }
  const missing = ["RESERVE_CONTRACT", "LOGGER_OPERATOR_ID", "LOGGER_OPERATOR_KEY"].filter(k => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")}. Copy packages/logger/.env.example to .env and fill it in.`);
  }
  const pollIntervalMs = Number(env.POLL_INTERVAL_MS || 10_000);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1_000) {
    throw new Error("POLL_INTERVAL_MS must be a number of at least 1000");
  }
  return {
    network,
    mirrorNodeUrl: (env.MIRROR_NODE_URL || MIRROR[network]).replace(/\/$/, ""),
    contract: env.RESERVE_CONTRACT!.trim(),
    operatorId: env.LOGGER_OPERATOR_ID!.trim(),
    operatorKey: env.LOGGER_OPERATOR_KEY!.trim(),
    topicId: env.HCS_TOPIC_ID?.trim() || undefined,
    pollIntervalMs,
    stateFile: env.LOGGER_STATE_FILE || ".logger-state.json",
  };
}
