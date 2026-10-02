// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IReserveSource
/// @notice Something that can say what a reserve is worth in USD.
/// @dev The Reserve implements this for its on-chain HBAR collateral. A Proof of Reserve
///      adapter (for example a Chainlink PoR feed, once one is published on Hedera) can
///      implement the same interface. Values use the token's 6 decimals.
interface IReserveSource {
    /// USD value of the reserve held for `account`.
    function reserveValueUsd(address account) external view returns (uint256);

    /// USD value of the whole reserve.
    function totalReserveValueUsd() external view returns (uint256);
}
