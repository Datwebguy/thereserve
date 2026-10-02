// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReserveMath
/// @notice Pure unit and ratio math for The Reserve. Every unit conversion lives here.
/// @dev Units:
///      - HBAR inside Hedera contracts (msg.value, balances) is in tinybars: 8 decimals.
///        The JSON-RPC relay and wallets show weibars (18 decimals); 1 tinybar = 10^10 weibars.
///      - Chainlink HBAR/USD answers have 8 decimals.
///      - The Reserve's token has 6 decimals.
library ReserveMath {
    uint256 internal constant TINYBARS_PER_HBAR = 1e8;
    uint256 internal constant WEIBARS_PER_TINYBAR = 1e10;
    uint256 internal constant PRICE_DECIMALS = 8;
    uint256 internal constant TOKEN_DECIMALS = 6;
    uint256 internal constant BPS = 10_000;

    /// tinybars (8) * price (8) = 16 decimals; the token has 6, so divide by 10^10.
    uint256 internal constant VALUE_DIVISOR = 10 ** (8 + PRICE_DECIMALS - TOKEN_DECIMALS);

    /// Converts a relay/wallet amount in weibars to tinybars. Rounds down.
    function weibarsToTinybars(uint256 weibars) internal pure returns (uint256) {
        return weibars / WEIBARS_PER_TINYBAR;
    }

    /// Converts tinybars to weibars.
    function tinybarsToWeibars(uint256 tinybars) internal pure returns (uint256) {
        return tinybars * WEIBARS_PER_TINYBAR;
    }

    /// USD value, in token units, of `tinybars` at `price` (8 decimals). Rounds down.
    function usdValue(uint256 tinybars, uint256 price) internal pure returns (uint256) {
        return (tinybars * price) / VALUE_DIVISOR;
    }

    /// Collateral ratio in basis points. Returns type(uint256).max when there is no debt.
    function ratioBps(uint256 tinybars, uint256 debt, uint256 price) internal pure returns (uint256) {
        if (debt == 0) return type(uint256).max;
        return (usdValue(tinybars, price) * BPS) / debt;
    }

    /// Largest total debt `tinybars` of collateral can carry at `minRatioBps`. Rounds down.
    function maxDebt(uint256 tinybars, uint256 price, uint256 minRatioBps) internal pure returns (uint256) {
        return (usdValue(tinybars, price) * BPS) / minRatioBps;
    }

    /// How much more can be minted on top of `debt`. Zero if already at or past the limit.
    function maxMintable(
        uint256 tinybars,
        uint256 debt,
        uint256 price,
        uint256 minRatioBps
    ) internal pure returns (uint256) {
        uint256 limit = maxDebt(tinybars, price, minRatioBps);
        return limit > debt ? limit - debt : 0;
    }

    /// True if `debt` is covered by `tinybars` at `minRatioBps`.
    function isHealthy(
        uint256 tinybars,
        uint256 debt,
        uint256 price,
        uint256 minRatioBps
    ) internal pure returns (bool) {
        return debt <= maxDebt(tinybars, price, minRatioBps);
    }
}
