import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Runs against a fork of Hedera testnet (`yarn hardhat:test:fork`), with Hedera's
 * system-contracts-forking plugin emulating the HTS system contract at 0x167.
 * Needs network access to testnet.hashio.io. Skipped by the offline unit suite.
 */
const HBAR_USD_TESTNET = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const MAX_STALENESS = 90_000n;
/** ERC-20 facade every HTS fungible token exposes at its own address (HIP-218). */
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const MAX_JUMP_BPS = 2_000n;

(process.env.FORK_TESTS === "true" ? describe : describe.skip)("Hedera testnet fork", function () {
  this.timeout(180_000);

  it("reads Chainlink HBAR/USD with 8 decimals and a fresh answer", async function () {
    const feed = await ethers.getContractAt("AggregatorV3Interface", HBAR_USD_TESTNET);
    expect(await feed.decimals()).to.equal(8n);
    const [roundId, answer, , updatedAt, answeredInRound] = await feed.latestRoundData();
    const block = await ethers.provider.getBlock("latest");
    expect(answer).to.be.greaterThan(0n);
    expect(answeredInRound).to.be.greaterThanOrEqual(roundId);
    expect(BigInt(block!.timestamp) - updatedAt).to.be.lessThanOrEqual(MAX_STALENESS);
  });

  it("PriceGuard accepts the live testnet answer", async function () {
    const [deployer] = await ethers.getSigners();
    const guard = await ethers.deployContract("PriceGuard", [HBAR_USD_TESTNET, MAX_STALENESS, MAX_JUMP_BPS]);
    await guard.bindConsumer(deployer.address);
    const [ok, price, code] = await guard.getGuardedPrice.staticCall();
    expect(ok).to.equal(true);
    expect(code).to.equal(0n);
    expect(price).to.be.greaterThan(0n);
  });

  it("creates the token, deposits and mints through the emulated HTS system contract", async function () {
    const [deployer] = await ethers.getSigners();
    const guard = await ethers.deployContract("PriceGuard", [HBAR_USD_TESTNET, MAX_STALENESS, MAX_JUMP_BPS]);
    const reserve = await ethers.deployContract("TheReserve", [await guard.getAddress(), 15_000n]);
    await guard.bindConsumer(await reserve.getAddress());

    await reserve.createToken("Reserve USD", "rUSD", { value: ethers.parseUnits("20", 8) });
    const tokenAddress = await reserve.token();
    expect(tokenAddress).to.not.equal(ethers.ZeroAddress);

    await reserve.deposit({ value: ethers.parseUnits("1000", 8) });
    await expect(reserve.mint(1_000_000n)).to.emit(reserve, "Minted");
    const token = await ethers.getContractAt(ERC20, tokenAddress);
    expect(await token.balanceOf(deployer.address)).to.equal(1_000_000n);
    expect(await token.totalSupply()).to.equal(1_000_000n);
  });

  it("burns through an ERC-20 allowance on the emulated HTS token", async function () {
    const [deployer] = await ethers.getSigners();
    const guard = await ethers.deployContract("PriceGuard", [HBAR_USD_TESTNET, MAX_STALENESS, MAX_JUMP_BPS]);
    const reserve = await ethers.deployContract("TheReserve", [await guard.getAddress(), 15_000n]);
    await guard.bindConsumer(await reserve.getAddress());
    await reserve.createToken("Reserve USD", "rUSD", { value: ethers.parseUnits("20", 8) });
    await reserve.deposit({ value: ethers.parseUnits("1000", 8) });
    await reserve.mint(1_000_000n);

    const token = await ethers.getContractAt(ERC20, await reserve.token());
    await token.approve(await reserve.getAddress(), 400_000n);
    await expect(reserve.burn(400_000n)).to.emit(reserve, "Burned");
    expect(await token.totalSupply()).to.equal(600_000n);
    expect(await reserve.debt(deployer.address)).to.equal(600_000n);
  });
});
