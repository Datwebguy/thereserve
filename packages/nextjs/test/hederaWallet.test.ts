import assert from "node:assert/strict";
import { test } from "node:test";
import { type Abi, decodeFunctionData } from "viem";
import { describeLogs } from "~~/components/reserve";
import deployedContracts from "~~/contracts/deployedContracts";
import {
  type MirrorLog,
  callData,
  entityIdFromLongZero,
  mirrorLogsToViem,
  toMirrorTransactionId,
} from "~~/utils/hederaWallet";
import { htsTokenAbi } from "~~/utils/reserve";

const reserveAbi = deployedContracts[296].TheReserve.abi as Abi;

test("SDK transaction IDs convert to the Mirror Node form", () => {
  assert.equal(toMirrorTransactionId("0.0.10460744@1791013731.281549818"), "0.0.10460744-1791013731-281549818");
  assert.equal(toMirrorTransactionId("0.0.10460744-1791013731-281549818"), "0.0.10460744-1791013731-281549818");
  assert.throws(() => toMirrorTransactionId("0x07695edb"), /Not a Hedera transaction ID/);
});

test("long-zero addresses map to entity IDs; other addresses do not", () => {
  // rUSD, the HTS token TheReserve created on testnet.
  assert.equal(entityIdFromLongZero("0x0000000000000000000000000000000000A56254"), "0.0.10838612");
  // TheReserve itself was deployed through the relay, so its address is not long-zero.
  assert.equal(entityIdFromLongZero("0x2B82C027916302E828607645fCB63644468738c7"), undefined);
  assert.equal(entityIdFromLongZero("0x0000000000000000000000000000000000000000"), undefined);
  assert.equal(entityIdFromLongZero("not an address"), undefined);
});

test("call data round-trips through the ABI", () => {
  const data = callData(reserveAbi, "mint", [3_354_055n]);
  const hex = `0x${Buffer.from(data).toString("hex")}` as const;
  const decoded = decodeFunctionData({ abi: reserveAbi, data: hex });
  assert.equal(decoded.functionName, "mint");
  assert.deepEqual(decoded.args, [3_354_055n]);

  const associate = callData(htsTokenAbi as Abi, "associate");
  assert.equal(associate.length, 4, "associate() is just its selector");
});

// Logs of testnet transaction 0x07695edb…81ee, the demo's mint above the ratio, as the Mirror Node
// returns them from /api/v1/contracts/results/{hash}.
const refusedMintLogs: MirrorLog[] = [
  {
    address: "0x13793ad8d2d6e746839a5d0840c23c4b735b938e",
    topics: ["0xf090902241d657b9f4e7b9a6d45e57583f42b64825f35a7b1061eae5cfe63852"],
    data: "0x0000000000000000000000000000000000000000000000000000000000998955000000000000000000000000000000000000000000000000000000006ac0ad16000000000000000000000000000000000000000000000001000000000000b02b",
  },
  {
    address: "0x2b82c027916302e828607645fcb63644468738c7",
    topics: [
      "0xd228a865587f7f99907c5b90747e878662c1d72f99138490189b7fc870100cb6",
      "0x000000000000000000000000395a5aac5ca96d8c85214afd66884f7ab4402473",
    ],
    data: "0x00000000000000000000000000000000000000000000000000000000013312aa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000998955",
  },
];

test("a refused mint read from the Mirror Node is reported as refused", () => {
  const hash = "0x07695edb60d2fd2cdd2d1b5267fb1c44d99b166d0083906f7c010fb4623081ee";
  const outcome = describeLogs(reserveAbi, mirrorLogsToViem(refusedMintLogs), hash, 296);
  assert.equal(outcome.kind, "rejected");
  assert.match(outcome.title, /^Mint refused: .+ \(code 1\)$/);
  assert.equal(outcome.link, `https://hashscan.io/testnet/transaction/${hash}`);
});
