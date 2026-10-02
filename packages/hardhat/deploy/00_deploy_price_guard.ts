import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { CHAINLINK_HBAR_USD, envNumber } from "../utils/hedera";

/**
 * Deploys PriceGuard over Chainlink's HBAR/USD feed.
 *
 * GUARD_MAX_STALENESS defaults to 90,000 s: the feed's 24 h heartbeat plus a 1 h margin.
 * GUARD_MAX_JUMP_BPS defaults to 2,000 (20%).
 */
const deployPriceGuard: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const feed = process.env.CHAINLINK_HBAR_USD_FEED || CHAINLINK_HBAR_USD[hre.network.name];
  if (!feed) throw new Error(`No HBAR/USD feed for network ${hre.network.name}; set CHAINLINK_HBAR_USD_FEED`);

  const maxStaleness = envNumber("GUARD_MAX_STALENESS", 90_000n);
  const maxJumpBps = envNumber("GUARD_MAX_JUMP_BPS", 2_000n);

  await hre.deployments.deploy("PriceGuard", {
    from: deployer,
    args: [feed, maxStaleness, maxJumpBps],
    log: true,
    autoMine: true,
    gasLimit: "2000000",
    gasPrice: await getDeployGasPrice(hre),
  });
};

deployPriceGuard.tags = ["PriceGuard", "TheReserve"];
export default deployPriceGuard;
