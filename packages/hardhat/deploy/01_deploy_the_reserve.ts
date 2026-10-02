import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { envNumber, hashscanContract, hashscanToken, hashscanTx, hbarValue, isHederaNetwork } from "../utils/hedera";

/**
 * Deploys TheReserve, binds it as PriceGuard's only consumer, and has it create its HTS token.
 *
 * The token is created by the contract itself through the HTS system contract, so the contract is
 * both treasury and the only supply key, and the token has no admin key. An SDK
 * TokenCreateTransaction cannot do this: the treasury must sign token creation, and a contract
 * cannot sign an SDK transaction.
 *
 * MIN_RATIO_BPS defaults to 15,000 (150%). TOKEN_CREATE_HBAR (default 20) pays the HTS creation fee;
 * the contract refunds whatever is not used.
 */
const deployTheReserve: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const gasPrice = await getDeployGasPrice(hre);
  const guardDeployment = await hre.deployments.get("PriceGuard");

  const result = await hre.deployments.deploy("TheReserve", {
    from: deployer,
    args: [guardDeployment.address, envNumber("MIN_RATIO_BPS", 15_000n)],
    log: true,
    autoMine: true,
    gasLimit: "4000000",
    gasPrice,
  });

  const signer = await hre.ethers.getSigner(deployer);
  const guard = await hre.ethers.getContractAt("PriceGuard", guardDeployment.address, signer);
  const reserve = await hre.ethers.getContractAt("TheReserve", result.address, signer);
  // HashScan only knows about real Hedera networks; never print links for a local chain.
  const link = (hash: string) => (isHederaNetwork(hre) ? `: ${hashscanTx(hre, hash)}` : ` (${hash})`);

  if ((await guard.consumer()) === hre.ethers.ZeroAddress) {
    const tx = await guard.bindConsumer(result.address, { gasLimit: 100_000, gasPrice });
    await tx.wait();
    console.log(`PriceGuard bound to TheReserve${link(tx.hash)}`);
  }

  if ((await reserve.token()) === hre.ethers.ZeroAddress) {
    const fee = process.env.TOKEN_CREATE_HBAR || "20";
    const tx = await reserve.createToken(process.env.TOKEN_NAME || "Reserve USD", process.env.TOKEN_SYMBOL || "rUSD", {
      value: hbarValue(hre, fee),
      gasLimit: 1_500_000,
      gasPrice,
    });
    await tx.wait();
    console.log(`HTS token created by TheReserve${link(tx.hash)}`);
  }

  const token = await reserve.token();
  console.log(`TheReserve: ${result.address}`);
  console.log(`Token:      ${token}`);
  if (isHederaNetwork(hre)) {
    console.log(`  ${hashscanContract(hre, result.address)}`);
    console.log(`  ${hashscanToken(hre, token)}`);
  }
};

deployTheReserve.tags = ["TheReserve"];
deployTheReserve.dependencies = ["PriceGuard"];
export default deployTheReserve;
