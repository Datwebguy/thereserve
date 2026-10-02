// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReasonCodes
/// @notice Why a mint, withdraw or price was refused. Shared by events, the logger and the UI.
/// @dev Keep in sync with the README table and packages/nextjs/utils/reasonCodes.ts.
library ReasonCodes {
    uint8 internal constant OK = 0;
    /// The action would leave the account below the minimum collateral ratio.
    uint8 internal constant RATIO_TOO_LOW = 1;
    /// The price is older than the guard's maxStaleness.
    uint8 internal constant PRICE_STALE = 2;
    /// The price is zero or negative, the round is incomplete, or the feed call failed.
    uint8 internal constant PRICE_MALFORMED = 3;
    /// The price moved more than maxJumpBps from the last accepted price.
    uint8 internal constant PRICE_JUMP = 4;
    /// Reserved: a second price source disagrees. Not enabled in v1.
    uint8 internal constant SOURCE_DISAGREES = 5;
    /// The receiver has not associated the HTS token.
    uint8 internal constant NOT_ASSOCIATED = 6;
}
