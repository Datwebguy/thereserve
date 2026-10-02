// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ReserveMath } from "../ReserveMath.sol";

/// Test-only wrapper that exposes ReserveMath's internal functions.
contract ReserveMathHarness {
    function weibarsToTinybars(uint256 weibars) external pure returns (uint256) {
        return ReserveMath.weibarsToTinybars(weibars);
    }

    function tinybarsToWeibars(uint256 tinybars) external pure returns (uint256) {
        return ReserveMath.tinybarsToWeibars(tinybars);
    }

    function usdValue(uint256 tinybars, uint256 price) external pure returns (uint256) {
        return ReserveMath.usdValue(tinybars, price);
    }

    function ratioBps(uint256 tinybars, uint256 debt, uint256 price) external pure returns (uint256) {
        return ReserveMath.ratioBps(tinybars, debt, price);
    }

    function maxDebt(uint256 tinybars, uint256 price, uint256 minRatioBps) external pure returns (uint256) {
        return ReserveMath.maxDebt(tinybars, price, minRatioBps);
    }

    function maxMintable(
        uint256 tinybars,
        uint256 debt,
        uint256 price,
        uint256 minRatioBps
    ) external pure returns (uint256) {
        return ReserveMath.maxMintable(tinybars, debt, price, minRatioBps);
    }

    function isHealthy(
        uint256 tinybars,
        uint256 debt,
        uint256 price,
        uint256 minRatioBps
    ) external pure returns (bool) {
        return ReserveMath.isHealthy(tinybars, debt, price, minRatioBps);
    }
}
