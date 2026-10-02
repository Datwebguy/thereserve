import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ReserveLogger } from "../src/logger";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/state";
import { ALICE, CONTRACT_ID, FakeMirror, FakePublisher, makeLog, tx } from "./fakes";

function setup(store: StateStore = new MemoryStateStore(), publisher = new FakePublisher()) {
  const mirror = new FakeMirror(publisher);
  const logger = new ReserveLogger(mirror, publisher, store, { contract: CONTRACT_ID });
  return { mirror, publisher, store, logger };
}

const deposit = makeLog("Deposited", [ALICE, 100_000_000_00n, 100_000_000_00n], tx(1), 0, "1790000000.000000001");
const minted = makeLog("Minted", [ALICE, 5_000_000n, 10_531_056n, 5_000_000n], tx(2), 0, "1790000010.000000001");
const rejected = makeLog("MintRejected", [ALICE, 99_000_000n, 1, 10_531_056n], tx(3), 0, "1790000020.000000001");

test("creates a topic when none is configured and remembers it", async () => {
  const { logger, publisher, store } = setup();
  await logger.init();
  assert.equal(logger.topic, "0.0.7007");
  assert.equal(publisher.topicsCreated, 1);
  assert.equal(store.load().topicId, "0.0.7007");
});

test("uses a configured topic without creating one", async () => {
  const publisher = new FakePublisher();
  const logger = new ReserveLogger(new FakeMirror(publisher), publisher, new MemoryStateStore(), {
    contract: CONTRACT_ID,
    topicId: "0.0.42",
  });
  await logger.init();
  assert.equal(logger.topic, "0.0.42");
  assert.equal(publisher.topicsCreated, 0);
});

test("posts one message per event, in order, in the documented format", async () => {
  const { logger, mirror, publisher } = setup();
  mirror.logs.push(deposit, minted, rejected);
  await logger.init();
  assert.equal(await logger.pollOnce(), 3);

  const [d, m, r] = publisher.parsed();
  assert.deepEqual(d, {
    v: 1,
    event: "Deposited",
    account: ALICE,
    amount: "10000000000",
    unit: "tinybar",
    reasonCode: null,
    price: null,
    txHash: tx(1),
    logIndex: 0,
    consensusTimestamp: "1790000000.000000001",
    contract: CONTRACT_ID,
  });
  assert.equal(m.event, "Minted");
  assert.equal(m.price, "10531056");
  assert.equal(r.event, "MintRejected");
  assert.equal(r.reasonCode, 1);
  assert.equal(r.amount, "99000000");
});

test("never posts the same event twice across polls", async () => {
  const { logger, mirror, publisher } = setup();
  mirror.logs.push(deposit, minted);
  await logger.init();
  await logger.pollOnce();
  assert.equal(await logger.pollOnce(), 0);
  mirror.logs.push(rejected);
  assert.equal(await logger.pollOnce(), 1);
  assert.equal(publisher.messages.length, 3);
});

test("resumes from the stored position after a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reserve-logger-"));
  const file = path.join(dir, "state.json");
  const publisher = new FakePublisher();

  const first = setup(new FileStateStore(file), publisher);
  first.mirror.logs.push(deposit, minted);
  await first.logger.init();
  await first.logger.pollOnce();

  // New process, same state file and topic.
  const second = setup(new FileStateStore(file), publisher);
  second.mirror.logs.push(deposit, minted, rejected);
  await second.logger.init();
  assert.equal(await second.logger.pollOnce(), 1);
  assert.equal(second.mirror.queries[0], "1790000010.000000001");
  assert.equal(publisher.messages.length, 3);
  assert.equal(publisher.topicsCreated, 1);
  fs.rmSync(dir, { recursive: true });
});

test("does not repost an event posted just before a crash", async () => {
  const store = new MemoryStateStore();
  const publisher = new FakePublisher();
  const first = setup(store, publisher);
  first.mirror.logs.push(deposit, minted);
  await first.logger.init();
  publisher.crashAfterNext = true;
  await assert.rejects(first.logger.pollOnce(), /process killed/);
  assert.equal(publisher.messages.length, 1); // posted, but not saved

  const second = setup(store, publisher);
  second.mirror.logs.push(deposit, minted);
  await second.logger.init();
  assert.equal(await second.logger.pollOnce(), 1); // only Minted
  assert.deepEqual(
    publisher.parsed().map(m => m.event),
    ["Deposited", "Minted"],
  );
});

test("finishes a transaction whose events were only partly posted", async () => {
  // Two events in one transaction share a timestamp.
  const a = makeLog("Deposited", [ALICE, 1n, 1n], tx(9), 0, "1790000030.000000001");
  const b = makeLog("MintRejected", [ALICE, 5n, 2, 0n], tx(9), 1, "1790000030.000000001");
  const store = new MemoryStateStore();
  const publisher = new FakePublisher();
  const first = setup(store, publisher);
  first.mirror.logs.push(a, b);
  await first.logger.init();
  publisher.crashAfterNext = true;
  await assert.rejects(first.logger.pollOnce());

  const second = setup(store, publisher);
  second.mirror.logs.push(a, b);
  await second.logger.init();
  assert.equal(await second.logger.pollOnce(), 1);
  const last = publisher.parsed().at(-1);
  assert.equal(last.logIndex, 1);
  assert.equal(last.price, null); // refused price of 0 is logged as null
});

test("skips logs that are not The Reserve's events", async () => {
  const { logger, mirror, publisher } = setup();
  mirror.logs.push({ ...deposit, topics: ["0x" + "ab".repeat(32)], transaction_hash: tx(77) });
  await logger.init();
  assert.equal(await logger.pollOnce(), 0);
  assert.equal(publisher.messages.length, 0);
});
