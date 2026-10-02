import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { Interface } from "ethers";

import { RESERVE_EVENTS, isLater, reserveInterface } from "../src/events";
import { loadConfig } from "../src/config";

const ARTIFACT = path.join(__dirname, "../../hardhat/artifacts/contracts/TheReserve.sol/TheReserve.json");

test("event definitions match the compiled TheReserve ABI", { skip: !fs.existsSync(ARTIFACT) }, () => {
  const compiled = new Interface(JSON.parse(fs.readFileSync(ARTIFACT, "utf8")).abi);
  const compiledEvents = new Map<string, string>();
  compiled.forEachEvent(e => compiledEvents.set(e.name, e.format("full")));
  reserveInterface.forEachEvent(e => {
    assert.equal(compiledEvents.get(e.name), e.format("full"), `${e.name} differs from the contract`);
  });
  assert.equal(RESERVE_EVENTS.length, compiledEvents.size, "the logger must know every event the contract emits");
});

test("compares consensus timestamps numerically", () => {
  assert.equal(isLater("1790000000.000000002", "1790000000.000000001"), true);
  assert.equal(isLater("1790000000.1", "1790000000.000000002"), true);
  assert.equal(isLater("999.0", "1000.0"), false);
  assert.equal(isLater("1.0", "0"), true);
});

test("config names every missing variable", () => {
  assert.throws(() => loadConfig({}), /RESERVE_CONTRACT, LOGGER_OPERATOR_ID, LOGGER_OPERATOR_KEY/);
  const config = loadConfig({ RESERVE_CONTRACT: "0.0.1", LOGGER_OPERATOR_ID: "0.0.2", LOGGER_OPERATOR_KEY: "k" });
  assert.equal(config.network, "testnet");
  assert.equal(config.mirrorNodeUrl, "https://testnet.mirrornode.hedera.com");
  assert.equal(config.topicId, undefined);
});
