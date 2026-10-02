import { expect } from "chai";
import { ethers } from "hardhat";
import { HBAR, USD, price, MIN_RATIO_BPS } from "./helpers";

describe("ReserveMath", function () {
  async function deploy() {
    return ethers.deployContract("ReserveMathHarness");
  }

  describe("unit conversion", function () {
    it("converts weibars (18 decimals) to tinybars (8 decimals) and back", async function () {
      const m = await deploy();
      expect(await m.weibarsToTinybars(ethers.parseEther("1"))).to.equal(HBAR);
      expect(await m.tinybarsToWeibars(HBAR)).to.equal(ethers.parseEther("1"));
    });

    it("rounds partial tinybars down", async function () {
      const m = await deploy();
      expect(await m.weibarsToTinybars(10n ** 10n - 1n)).to.equal(0n);
      expect(await m.weibarsToTinybars(10n ** 10n + 1n)).to.equal(1n);
    });

    it("values HBAR in USD at the token's 6 decimals", async function () {
      const m = await deploy();
      // 1,000 HBAR at $0.10 = $100
      expect(await m.usdValue(1_000n * HBAR, price(0.1))).to.equal(100n * USD);
      // 1 tinybar at $0.10 is below one token unit
      expect(await m.usdValue(1n, price(0.1))).to.equal(0n);
    });
  });

  describe("ratio", function () {
    it("is max uint with no debt", async function () {
      const m = await deploy();
      expect(await m.ratioBps(1_000n * HBAR, 0n, price(0.1))).to.equal(ethers.MaxUint256);
    });

    it("is 15,000 bps when collateral is worth 1.5x the debt", async function () {
      const m = await deploy();
      expect(await m.ratioBps(1_500n * HBAR, 100n * USD, price(0.1))).to.equal(15_000n);
    });

    it("is 0 with zero collateral and some debt", async function () {
      const m = await deploy();
      expect(await m.ratioBps(0n, 1n, price(0.1))).to.equal(0n);
    });
  });

  describe("max mintable", function () {
    it("allows $100 of debt on $150 of collateral at 150%", async function () {
      const m = await deploy();
      expect(await m.maxDebt(1_500n * HBAR, price(0.1), MIN_RATIO_BPS)).to.equal(100n * USD);
      expect(await m.maxMintable(1_500n * HBAR, 40n * USD, price(0.1), MIN_RATIO_BPS)).to.equal(60n * USD);
    });

    it("is healthy exactly at the minimum ratio and unhealthy one unit above", async function () {
      const m = await deploy();
      expect(await m.isHealthy(1_500n * HBAR, 100n * USD, price(0.1), MIN_RATIO_BPS)).to.equal(true);
      expect(await m.isHealthy(1_500n * HBAR, 100n * USD + 1n, price(0.1), MIN_RATIO_BPS)).to.equal(false);
    });

    it("is zero with zero collateral or when already past the limit", async function () {
      const m = await deploy();
      expect(await m.maxMintable(0n, 0n, price(0.1), MIN_RATIO_BPS)).to.equal(0n);
      expect(await m.maxMintable(1_500n * HBAR, 200n * USD, price(0.1), MIN_RATIO_BPS)).to.equal(0n);
    });

    it("does not overflow with very large values", async function () {
      const m = await deploy();
      // All 50 billion HBAR at $1,000,000
      const all = 50_000_000_000n * HBAR;
      const value = await m.usdValue(all, price(1_000_000));
      expect(value).to.equal(50_000_000_000n * 1_000_000n * USD);
      expect(await m.maxDebt(all, price(1_000_000), MIN_RATIO_BPS)).to.equal((value * 10_000n) / MIN_RATIO_BPS);
    });
  });
});
