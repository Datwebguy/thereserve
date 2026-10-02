import * as dotenv from "dotenv";
dotenv.config();

import { loadConfig } from "./config";
import { ReserveLogger } from "./logger";
import { MirrorNodeClient } from "./mirror";
import { HcsPublisher } from "./publisher";
import { FileStateStore } from "./state";

async function main() {
  const config = loadConfig();
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  const publisher = new HcsPublisher(config.network, config.operatorId, config.operatorKey);
  const logger = new ReserveLogger(
    new MirrorNodeClient(config.mirrorNodeUrl),
    publisher,
    new FileStateStore(config.stateFile),
    { contract: config.contract, topicId: config.topicId, log },
  );

  await logger.init();
  const hashscan = `https://hashscan.io/${config.network}/topic/${logger.topic}`;
  log(`Watching ${config.contract} on ${config.network}; posting to ${logger.topic} (${hashscan})`);

  let stopping = false;
  const stop = () => {
    stopping = true;
    log("Stopping after the current poll.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    try {
      const posted = await logger.pollOnce();
      if (posted > 0) log(`Posted ${posted} event(s).`);
    } catch (error) {
      // Mirror Node or network hiccup: keep the stored position and try again next poll.
      log(`Poll failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }
  publisher.close();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
