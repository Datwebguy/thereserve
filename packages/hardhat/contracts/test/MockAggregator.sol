// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";

/// Test-only Chainlink feed whose round data the test sets directly.
contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    bool public reverts;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "HBAR / USD (mock)";
    }

    /// Sets a complete round published at `updatedAt_`.
    function setPrice(int256 answer_, uint256 updatedAt_) external {
        roundId += 1;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = roundId;
    }

    /// Sets every field, for malformed-round tests.
    function setRound(int256 answer_, uint256 updatedAt_, uint80 roundId_, uint80 answeredInRound_) external {
        roundId = roundId_;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function setReverts(bool reverts_) external {
        reverts = reverts_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverts, "feed down");
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}
