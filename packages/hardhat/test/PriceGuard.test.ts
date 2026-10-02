import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployGuard, price, Reason, MAX_STALENESS } from "./helpers";

describe("PriceGuard", function () {
  /** Guard whose consumer is a plain signer, so tests can call getGuardedPrice directly. */
  async function deploy() {
    const [deployer, consumer, other] = await ethers.getSigners();
    const { feed, guard } = await deployGuard();
    await guard.bindConsumer(consumer.address);
    return { deployer, consumer, other, feed, guard, g: guard.connect(consumer) };
  }

  /** Calls getGuardedPrice and returns what it returned, then sends it for real. */
  async function guarded(g: Awaited<ReturnType<typeof deploy>>["g"]) {
    const result = await g.getGuardedPrice.staticCall();
    await g.getGuardedPrice();
    return { ok: result[0], price: result[1], code: Number(result[2]) };
  }

  describe("setup", function () {
    it("rejects bad parameters", async function () {
      const Guard = await ethers.getContractFactory("PriceGuard");
      const feed = await ethers.deployContract("MockAggregator");
      await expect(Guard.deploy(ethers.ZeroAddress, 1, 1)).to.be.revertedWithCustomError(Guard, "InvalidParameter");
      await expect(Guard.deploy(await feed.getAddress(), 0, 1)).to.be.revertedWithCustomError(
        Guard,
        "InvalidParameter",
      );
      await expect(Guard.deploy(await feed.getAddress(), 1, 10_001)).to.be.revertedWithCustomError(
        Guard,
        "InvalidParameter",
      );
    });

    it("binds its consumer once, and only the deployer can bind", async function () {
      const { guard, other, consumer } = await deploy();
      await expect(guard.connect(other).bindConsumer(other.address)).to.be.revertedWithCustomError(
        guard,
        "NotDeployer",
      );
      await expect(guard.bindConsumer(other.address)).to.be.revertedWithCustomError(guard, "ConsumerAlreadyBound");
      expect(await guard.consumer()).to.equal(consumer.address);
    });

    it("only lets the consumer record prices", async function () {
      const { guard, other } = await deploy();
      await expect(guard.connect(other).getGuardedPrice()).to.be.revertedWithCustomError(guard, "NotConsumer");
    });
  });

  describe("checks", function () {
    it("accepts a good price and records it", async function () {
      const { g, guard, feed } = await deploy();
      const r = await guarded(g);
      expect(r).to.deep.equal({ ok: true, price: price(0.1), code: Reason.OK });
      expect(await guard.lastPrice()).to.equal(price(0.1));
      expect(await guard.lastUpdatedAt()).to.equal(await feed.updatedAt());
    });

    it("emits PriceAccepted", async function () {
      const { g, guard } = await deploy();
      await expect(g.getGuardedPrice()).to.emit(guard, "PriceAccepted");
    });

    it("refuses a zero price", async function () {
      const { g, feed, guard } = await deploy();
      await feed.setPrice(0, await time.latest());
      const r = await guarded(g);
      expect(r.ok).to.equal(false);
      expect(r.code).to.equal(Reason.PRICE_MALFORMED);
      expect(await guard.lastPrice()).to.equal(0n);
    });

    it("refuses a negative price", async function () {
      const { g, feed } = await deploy();
      await feed.setPrice(-1, await time.latest());
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
    });

    it("refuses an incomplete round (answeredInRound < roundId)", async function () {
      const { g, feed } = await deploy();
      await feed.setRound(price(0.1), await time.latest(), 5, 4);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
    });

    it("refuses a round with no timestamp, or one in the future", async function () {
      const { g, feed } = await deploy();
      await feed.setRound(price(0.1), 0, 1, 1);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
      await feed.setRound(price(0.1), (await time.latest()) + 1000, 2, 2);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
    });

    it("refuses with code 3 when the feed call reverts", async function () {
      const { g, feed, guard } = await deploy();
      await feed.setReverts(true);
      await expect(g.getGuardedPrice()).to.emit(guard, "PriceRefused").withArgs(Reason.PRICE_MALFORMED, 0, 0, 0);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
    });

    it("refuses a stale price", async function () {
      const { g, feed } = await deploy();
      await feed.setPrice(price(0.1), BigInt(await time.latest()) - MAX_STALENESS - 100n);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_STALE);
    });

    it("accepts a price exactly maxStaleness old and refuses one a second older", async function () {
      const { guard } = await deploy();
      const now = 1_000_000n;
      expect(await guard.check(price(0.1), now - MAX_STALENESS, 1, 1, now, 0, 0)).to.equal(Reason.OK);
      expect(await guard.check(price(0.1), now - MAX_STALENESS - 1n, 1, 1, now, 0, 0)).to.equal(Reason.PRICE_STALE);
    });

    it("refuses a jump above maxJumpBps and emits PriceRefused", async function () {
      const { g, feed, guard } = await deploy();
      await guarded(g); // accept $0.10
      await feed.setPrice(price(0.1201), await time.latest());
      await expect(g.getGuardedPrice()).to.emit(guard, "PriceRefused");
      expect((await guarded(g)).code).to.equal(Reason.PRICE_JUMP);
      expect(await guard.lastPrice()).to.equal(price(0.1));
    });

    it("accepts a jump exactly at maxJumpBps, up and down", async function () {
      const { g, feed, guard } = await deploy();
      await guarded(g);
      await feed.setPrice(price(0.12), await time.latest());
      expect((await guarded(g)).ok).to.equal(true);
      await feed.setPrice(price(0.096), await time.latest()); // -20% from 0.12
      expect((await guarded(g)).ok).to.equal(true);
      expect(await guard.lastPrice()).to.equal(price(0.096));
    });

    it("stops using the last price as a jump reference once it is older than maxStaleness", async function () {
      const { g, feed } = await deploy();
      await guarded(g); // accept $0.10
      await time.increase(MAX_STALENESS + 1n);
      await feed.setPrice(price(0.2), await time.latest()); // +100%, but the reference expired
      expect((await guarded(g)).ok).to.equal(true);
    });

    it("refuses a round older than the last accepted one", async function () {
      const { g, feed } = await deploy();
      await guarded(g);
      await feed.setPrice(price(0.1), (await feed.updatedAt()) - 10n);
      expect((await guarded(g)).code).to.equal(Reason.PRICE_MALFORMED);
    });
  });

  describe("evaluate, peek and simulate", function () {
    it("evaluate matches getGuardedPrice for the same inputs", async function () {
      const { g, guard, feed } = await deploy();
      await guarded(g);
      const now = await time.latest();
      const cases: [bigint, number][] = [
        [price(0.11), now],
        [price(0.15), now],
        [0n, now],
        [price(0.1), now - Number(MAX_STALENESS) - 10],
      ];
      for (const [answer, at] of cases) {
        await feed.setPrice(answer, at);
        const round = await feed.roundId();
        // evaluate runs at the current block; getGuardedPrice runs one block later, so use the
        // static call (same block as evaluate) for the comparison.
        const [ok, code] = await guard.evaluate(answer, at, round, round);
        const live = await g.getGuardedPrice.staticCall();
        expect([ok, Number(code)]).to.deep.equal([live[0], Number(live[2])]);
      }
    });

    it("peek reports without recording", async function () {
      const { guard, feed } = await deploy();
      const [ok, p, code, at] = await guard.peek();
      expect([ok, p, Number(code), at]).to.deep.equal([true, price(0.1), Reason.OK, await feed.updatedAt()]);
      expect(await guard.lastPrice()).to.equal(0n);
    });

    it("simulate applies the same rules to hypothetical inputs", async function () {
      const { guard } = await deploy();
      const sim = async (p: bigint, age: bigint, prev: bigint, prevAge: bigint) =>
        Number((await guard.simulate(p, age, prev, prevAge))[1]);
      expect(await sim(price(0.1), 60n, 0n, 0n)).to.equal(Reason.OK);
      expect(await sim(price(0.1), MAX_STALENESS + 1n, 0n, 0n)).to.equal(Reason.PRICE_STALE);
      expect(await sim(price(0.15), 60n, price(0.1), 3600n)).to.equal(Reason.PRICE_JUMP);
      expect(await sim(price(0.12), 60n, price(0.1), 3600n)).to.equal(Reason.OK);
      expect(await sim(0n, 60n, 0n, 0n)).to.equal(Reason.PRICE_MALFORMED);
    });
  });
});
