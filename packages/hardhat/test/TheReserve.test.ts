import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployReserve, HBAR, USD, price, Reason, MAX_STALENESS, MIN_RATIO_BPS, HTS_ADDRESS } from "./helpers";

describe("TheReserve", function () {
  // At $0.10, 1,500 HBAR is worth $150, which carries at most $100 of debt at 150%.
  const COLLATERAL = 1_500n * HBAR;
  const LIMIT = 100n * USD;

  async function funded() {
    const ctx = await deployReserve();
    await ctx.reserve.connect(ctx.alice).deposit({ value: COLLATERAL });
    return ctx;
  }

  describe("setup", function () {
    it("rejects a zero guard or a ratio below the 110% floor", async function () {
      const Reserve = await ethers.getContractFactory("TheReserve");
      await expect(Reserve.deploy(ethers.ZeroAddress, MIN_RATIO_BPS)).to.be.revertedWithCustomError(
        Reserve,
        "InvalidParameter",
      );
      await expect(Reserve.deploy(HTS_ADDRESS, 10_999)).to.be.revertedWithCustomError(Reserve, "InvalidParameter");
    });

    it("creates the token with itself as treasury and supply key", async function () {
      const { reserve, hts, token } = await deployReserve();
      const reserveAddress = await reserve.getAddress();
      expect(await hts.supplyKeyOf(await token.getAddress())).to.equal(reserveAddress);
      expect(await hts.treasuryOf(await token.getAddress())).to.equal(reserveAddress);
      expect(await token.decimals()).to.equal(6n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("creates the token only once, and only for the deployer", async function () {
      const { reserve, alice } = await deployReserve();
      await expect(reserve.createToken("X", "X")).to.be.revertedWithCustomError(reserve, "TokenAlreadyCreated");
      await expect(reserve.connect(alice).createToken("X", "X")).to.be.revertedWithCustomError(reserve, "NotDeployer");
    });

    it("refuses plain HBAR transfers so every deposit is credited", async function () {
      const { reserve, alice } = await deployReserve();
      await expect(
        alice.sendTransaction({ to: await reserve.getAddress(), value: HBAR }),
      ).to.be.revertedWithCustomError(reserve, "UseDeposit");
    });
  });

  describe("only The Reserve can mint", function () {
    it("refuses a mint from any other caller at the HTS level", async function () {
      const { hts, token, alice } = await deployReserve();
      const [rc] = await hts.connect(alice).mintToken.staticCall(await token.getAddress(), 1_000n, []);
      expect(rc).to.not.equal(22n);
      await hts.connect(alice).mintToken(await token.getAddress(), 1_000n, []);
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("deposit", function () {
    it("credits the caller and emits Deposited", async function () {
      const { reserve, alice } = await deployReserve();
      await expect(reserve.connect(alice).deposit({ value: COLLATERAL }))
        .to.emit(reserve, "Deposited")
        .withArgs(alice.address, COLLATERAL, COLLATERAL);
      expect(await reserve.collateral(alice.address)).to.equal(COLLATERAL);
      expect(await reserve.totalCollateral()).to.equal(COLLATERAL);
    });

    it("rejects a zero deposit", async function () {
      const { reserve, alice } = await deployReserve();
      await expect(reserve.connect(alice).deposit()).to.be.revertedWithCustomError(reserve, "ZeroAmount");
    });
  });

  describe("mint", function () {
    it("mints within the ratio, sends the tokens and records debt", async function () {
      const { reserve, token, alice } = await funded();
      expect(await reserve.connect(alice).mint.staticCall(LIMIT)).to.equal(true);
      await expect(reserve.connect(alice).mint(LIMIT))
        .to.emit(reserve, "Minted")
        .withArgs(alice.address, LIMIT, price(0.1), LIMIT);
      expect(await token.balanceOf(alice.address)).to.equal(LIMIT);
      expect(await token.totalSupply()).to.equal(LIMIT);
      expect(await reserve.debt(alice.address)).to.equal(LIMIT);
      expect(await reserve.totalDebt()).to.equal(LIMIT);
      expect(await reserve.ratioOf(alice.address)).to.equal(MIN_RATIO_BPS);
    });

    it("returns false with code 1 above the ratio and mints nothing", async function () {
      const { reserve, token, alice } = await funded();
      expect(await reserve.connect(alice).mint.staticCall(LIMIT + 1n)).to.equal(false);
      await expect(reserve.connect(alice).mint(LIMIT + 1n))
        .to.emit(reserve, "MintRejected")
        .withArgs(alice.address, LIMIT + 1n, Reason.RATIO_TOO_LOW, price(0.1));
      expect(await token.totalSupply()).to.equal(0n);
      expect(await reserve.debt(alice.address)).to.equal(0n);
    });

    it("counts existing debt against the limit", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(60n * USD);
      await expect(reserve.connect(alice).mint(41n * USD))
        .to.emit(reserve, "MintRejected")
        .withArgs(alice.address, 41n * USD, Reason.RATIO_TOO_LOW, price(0.1));
      await expect(reserve.connect(alice).mint(40n * USD)).to.emit(reserve, "Minted");
    });

    it("returns false with code 1 when the caller has no collateral", async function () {
      const { reserve, bob, token } = await deployReserve();
      await token.connect(bob).associate();
      await expect(reserve.connect(bob).mint(1n))
        .to.emit(reserve, "MintRejected")
        .withArgs(bob.address, 1n, Reason.RATIO_TOO_LOW, price(0.1));
    });

    it("returns false with the guard's code for a stale price and mints nothing", async function () {
      const { reserve, feed, token, alice } = await funded();
      await feed.setPrice(price(0.1), BigInt(await time.latest()) - MAX_STALENESS - 100n);
      await expect(reserve.connect(alice).mint(USD))
        .to.emit(reserve, "MintRejected")
        .withArgs(alice.address, USD, Reason.PRICE_STALE, price(0.1));
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("returns false with code 4 when the price jumps more than allowed", async function () {
      const { reserve, feed, token, alice } = await funded();
      await reserve.connect(alice).mint(USD); // records $0.10
      await feed.setPrice(price(0.5), await time.latest()); // +400%: would allow far more debt
      await expect(reserve.connect(alice).mint(LIMIT))
        .to.emit(reserve, "MintRejected")
        .withArgs(alice.address, LIMIT, Reason.PRICE_JUMP, price(0.5));
      expect(await token.totalSupply()).to.equal(USD);
    });

    it("returns false with code 3 when the feed is unreadable", async function () {
      const { reserve, feed, alice } = await funded();
      await feed.setReverts(true);
      await expect(reserve.connect(alice).mint(USD))
        .to.emit(reserve, "MintRejected")
        .withArgs(alice.address, USD, Reason.PRICE_MALFORMED, 0);
    });

    it("returns false with code 6 when the receiver has not associated the token, and leaves no supply", async function () {
      const { reserve, token, bob } = await deployReserve();
      await reserve.connect(bob).deposit({ value: COLLATERAL });
      await expect(reserve.connect(bob).mint(USD))
        .to.emit(reserve, "MintRejected")
        .withArgs(bob.address, USD, Reason.NOT_ASSOCIATED, price(0.1));
      expect(await token.totalSupply()).to.equal(0n);
      expect(await reserve.debt(bob.address)).to.equal(0n);
    });

    it("reverts on zero or oversized amounts", async function () {
      const { reserve, alice } = await funded();
      await expect(reserve.connect(alice).mint(0)).to.be.revertedWithCustomError(reserve, "ZeroAmount");
      await expect(reserve.connect(alice).mint(2n ** 63n)).to.be.revertedWithCustomError(reserve, "AmountTooLarge");
    });

    it("reverts before the token exists", async function () {
      const { guard } = await deployReserve();
      const reserve = await ethers.deployContract("TheReserve", [await guard.getAddress(), MIN_RATIO_BPS]);
      await expect(reserve.mint(USD)).to.be.revertedWithCustomError(reserve, "TokenNotCreated");
    });
  });

  describe("burn", function () {
    it("takes the tokens back, burns them and reduces debt", async function () {
      const { reserve, token, alice } = await funded();
      await reserve.connect(alice).mint(LIMIT);
      await token.connect(alice).approve(await reserve.getAddress(), 30n * USD);
      await expect(reserve.connect(alice).burn(30n * USD))
        .to.emit(reserve, "Burned")
        .withArgs(alice.address, 30n * USD, 70n * USD);
      expect(await token.balanceOf(alice.address)).to.equal(70n * USD);
      expect(await token.totalSupply()).to.equal(70n * USD);
      expect(await reserve.totalDebt()).to.equal(70n * USD);
    });

    it("works while the guard refuses every price", async function () {
      const { reserve, token, feed, alice } = await funded();
      await reserve.connect(alice).mint(LIMIT);
      await feed.setReverts(true);
      await token.connect(alice).approve(await reserve.getAddress(), LIMIT);
      await expect(reserve.connect(alice).burn(LIMIT)).to.emit(reserve, "Burned");
      expect(await reserve.debt(alice.address)).to.equal(0n);
    });

    it("reverts without an allowance, reporting the HTS response code", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(LIMIT);
      await expect(reserve.connect(alice).burn(USD))
        .to.be.revertedWithCustomError(reserve, "HtsCallFailed")
        .withArgs(292);
    });

    it("reverts when burning more than the caller's debt", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(USD);
      await expect(reserve.connect(alice).burn(USD + 1n)).to.be.revertedWithCustomError(reserve, "BurnExceedsDebt");
    });
  });

  describe("withdraw", function () {
    it("always works with zero debt, even when the feed is down", async function () {
      const { reserve, feed, alice } = await funded();
      await feed.setReverts(true);
      await expect(reserve.connect(alice).withdraw(COLLATERAL)).to.changeEtherBalances(
        [alice, reserve],
        [COLLATERAL, -COLLATERAL],
      );
      expect(await reserve.collateral(alice.address)).to.equal(0n);
    });

    it("works while the ratio holds afterwards", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(50n * USD); // needs $75 = 750 HBAR
      await expect(reserve.connect(alice).withdraw(750n * HBAR))
        .to.emit(reserve, "Withdrawn")
        .withArgs(alice.address, 750n * HBAR, price(0.1), 750n * HBAR);
    });

    it("returns false with code 1 when it would break the ratio", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(50n * USD);
      expect(await reserve.connect(alice).withdraw.staticCall(751n * HBAR)).to.equal(false);
      await expect(reserve.connect(alice).withdraw(751n * HBAR))
        .to.emit(reserve, "WithdrawRejected")
        .withArgs(alice.address, 751n * HBAR, Reason.RATIO_TOO_LOW, price(0.1));
      expect(await reserve.collateral(alice.address)).to.equal(COLLATERAL);
    });

    it("returns false with the guard's code when the price is refused and there is debt", async function () {
      const { reserve, feed, alice } = await funded();
      await reserve.connect(alice).mint(USD);
      await feed.setPrice(0, await time.latest());
      await expect(reserve.connect(alice).withdraw(HBAR))
        .to.emit(reserve, "WithdrawRejected")
        .withArgs(alice.address, HBAR, Reason.PRICE_MALFORMED, 0);
    });

    it("reverts when withdrawing more than deposited", async function () {
      const { reserve, alice } = await funded();
      await expect(reserve.connect(alice).withdraw(COLLATERAL + 1n)).to.be.revertedWithCustomError(
        reserve,
        "InsufficientCollateral",
      );
    });
  });

  describe("views", function () {
    it("reports the reserve summary at the last accepted price", async function () {
      const { reserve, alice, feed } = await funded();
      await reserve.connect(alice).mint(50n * USD);
      const s = await reserve.reserveSummary();
      expect(s.collateralTinybars).to.equal(COLLATERAL);
      expect(s.collateralUsd).to.equal(150n * USD);
      expect(s.supply).to.equal(50n * USD);
      expect(s.ratioBps).to.equal(30_000n);
      expect(s.lastPrice).to.equal(price(0.1));
      expect(s.lastPriceAge).to.equal(BigInt(await time.latest()) - (await feed.updatedAt()));
      expect(await reserve.totalReserveValueUsd()).to.equal(150n * USD);
      expect(await reserve.reserveValueUsd(alice.address)).to.equal(150n * USD);
    });

    it("reports how much more an account can mint", async function () {
      const { reserve, alice } = await funded();
      await reserve.connect(alice).mint(USD); // records a price
      expect(await reserve.maxMintableOf(alice.address)).to.equal(LIMIT - USD);
    });
  });
});
