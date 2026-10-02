// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { ReasonCodes } from "./ReasonCodes.sol";

/// @title PriceGuard
/// @notice Reads Chainlink's HBAR/USD feed and decides whether to trust the answer.
/// @dev Checks, in order:
///      1. answer > 0                                          (code 3)
///      2. updatedAt != 0, not in the future, answeredInRound >= roundId,
///         and not older than the last accepted price          (code 3)
///      3. now - updatedAt <= maxStaleness                     (code 2)
///      4. |answer - lastPrice| <= lastPrice * maxJumpBps      (code 4)
///         Only while the last accepted price is a live reference, meaning it was
///         published no more than maxStaleness before this answer. Once it is older
///         than that it no longer counts, so a real market move is not refused forever.
///      There is no admin: parameters are fixed at deployment.
contract PriceGuard {
    uint256 public constant BPS = 10_000;

    AggregatorV3Interface public immutable feed;
    uint256 public immutable maxStaleness;
    uint256 public immutable maxJumpBps;
    address public immutable deployer;

    /// The only contract allowed to update the last accepted price. Set once.
    address public consumer;

    uint256 public lastPrice;
    uint256 public lastUpdatedAt;

    event ConsumerBound(address indexed consumer);
    event PriceAccepted(uint256 price, uint256 updatedAt, uint80 roundId);
    event PriceRefused(uint8 indexed reasonCode, int256 answer, uint256 updatedAt, uint80 roundId);

    error NotDeployer();
    error NotConsumer();
    error ConsumerAlreadyBound();
    error InvalidParameter();

    constructor(address feed_, uint256 maxStaleness_, uint256 maxJumpBps_) {
        if (feed_ == address(0) || maxStaleness_ == 0 || maxJumpBps_ == 0 || maxJumpBps_ > BPS) {
            revert InvalidParameter();
        }
        feed = AggregatorV3Interface(feed_);
        maxStaleness = maxStaleness_;
        maxJumpBps = maxJumpBps_;
        deployer = msg.sender;
    }

    /// Binds the contract (The Reserve) that may record accepted prices. Callable once.
    function bindConsumer(address consumer_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (consumer != address(0)) revert ConsumerAlreadyBound();
        if (consumer_ == address(0)) revert InvalidParameter();
        consumer = consumer_;
        emit ConsumerBound(consumer_);
    }

    /// Reads the feed, runs every check and, if the price passes, stores it as the last accepted price.
    /// @return ok True if the price can be used.
    /// @return price The answer (8 decimals). Returned even when refused, for logging; 0 if unreadable.
    /// @return reasonCode 0 when ok, otherwise a ReasonCodes value.
    function getGuardedPrice() external returns (bool ok, uint256 price, uint8 reasonCode) {
        if (msg.sender != consumer) revert NotConsumer();

        (bool readable, uint80 roundId, int256 answer, uint256 updatedAt, uint80 answeredInRound) = _readFeed();
        if (!readable) {
            emit PriceRefused(ReasonCodes.PRICE_MALFORMED, 0, 0, 0);
            return (false, 0, ReasonCodes.PRICE_MALFORMED);
        }

        reasonCode = check(answer, updatedAt, roundId, answeredInRound, block.timestamp, lastPrice, lastUpdatedAt);
        price = answer > 0 ? uint256(answer) : 0;

        if (reasonCode != ReasonCodes.OK) {
            emit PriceRefused(reasonCode, answer, updatedAt, roundId);
            return (false, price, reasonCode);
        }

        lastPrice = price;
        lastUpdatedAt = updatedAt;
        emit PriceAccepted(price, updatedAt, roundId);
        return (true, price, ReasonCodes.OK);
    }

    /// Runs the checks on values the caller supplies, against the stored last accepted price
    /// and the current block time. No state change.
    function evaluate(
        int256 answer,
        uint256 updatedAt,
        uint80 roundId,
        uint80 answeredInRound
    ) external view returns (bool ok, uint8 reasonCode) {
        reasonCode = check(answer, updatedAt, roundId, answeredInRound, block.timestamp, lastPrice, lastUpdatedAt);
        ok = reasonCode == ReasonCodes.OK;
    }

    /// What the guard would say about the feed's current answer, without recording it.
    function peek() external view returns (bool ok, uint256 price, uint8 reasonCode, uint256 updatedAt) {
        (bool readable, uint80 roundId, int256 answer, uint256 at, uint80 answeredInRound) = _readFeed();
        if (!readable) return (false, 0, ReasonCodes.PRICE_MALFORMED, 0);
        reasonCode = check(answer, at, roundId, answeredInRound, block.timestamp, lastPrice, lastUpdatedAt);
        return (reasonCode == ReasonCodes.OK, answer > 0 ? uint256(answer) : 0, reasonCode, at);
    }

    /// Simulation helper for the UI: describe a price by its age and a previous price by its age.
    /// Uses this guard's parameters. Purely hypothetical; nothing here reads the feed.
    /// @param answer Hypothetical price (8 decimals).
    /// @param ageSeconds How long ago that price was published.
    /// @param previousPrice Hypothetical last accepted price (8 decimals); 0 means none.
    /// @param previousAgeSeconds How long ago the previous price was published.
    function simulate(
        int256 answer,
        uint256 ageSeconds,
        uint256 previousPrice,
        uint256 previousAgeSeconds
    ) external view returns (bool ok, uint8 reasonCode) {
        uint256 nowTs = block.timestamp;
        uint256 updatedAt = ageSeconds >= nowTs ? 1 : nowTs - ageSeconds;
        uint256 previousAt = previousAgeSeconds >= nowTs ? 1 : nowTs - previousAgeSeconds;
        reasonCode = check(answer, updatedAt, 1, 1, nowTs, previousPrice, previousPrice == 0 ? 0 : previousAt);
        ok = reasonCode == ReasonCodes.OK;
    }

    /// The guard's rules as a pure function. Returns 0 if the price passes.
    function check(
        int256 answer,
        uint256 updatedAt,
        uint80 roundId,
        uint80 answeredInRound,
        uint256 nowTs,
        uint256 previousPrice,
        uint256 previousUpdatedAt
    ) public view returns (uint8) {
        if (answer <= 0) return ReasonCodes.PRICE_MALFORMED;
        if (updatedAt == 0 || updatedAt > nowTs || answeredInRound < roundId) return ReasonCodes.PRICE_MALFORMED;
        if (updatedAt < previousUpdatedAt) return ReasonCodes.PRICE_MALFORMED;
        if (nowTs - updatedAt > maxStaleness) return ReasonCodes.PRICE_STALE;

        if (previousPrice != 0 && updatedAt - previousUpdatedAt <= maxStaleness) {
            uint256 price = uint256(answer);
            uint256 diff = price > previousPrice ? price - previousPrice : previousPrice - price;
            if (diff * BPS > previousPrice * maxJumpBps) return ReasonCodes.PRICE_JUMP;
        }
        return ReasonCodes.OK;
    }

    function _readFeed()
        internal
        view
        returns (bool readable, uint80 roundId, int256 answer, uint256 updatedAt, uint80 answeredInRound)
    {
        try feed.latestRoundData() returns (uint80 r, int256 a, uint256, uint256 u, uint80 ar) {
            return (true, r, a, u, ar);
        } catch {
            return (false, 0, 0, 0, 0);
        }
    }
}
