// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";
import { HederaResponseCodes } from "./interfaces/HederaResponseCodes.sol";
import { IReserveSource } from "./IReserveSource.sol";
import { PriceGuard } from "./PriceGuard.sol";
import { ReasonCodes } from "./ReasonCodes.sol";
import { ReserveMath } from "./ReserveMath.sol";

/// @title TheReserve
/// @notice Holds HBAR as collateral and issues a USD-denominated HTS token against it, never beyond
///         `minRatioBps`. Prices come only from PriceGuard.
/// @dev Rules this contract keeps:
///      - It is the token's treasury and only supply key, and creates the token itself. There is no
///        admin and no other way to mint.
///      - `mint` and `withdraw` return false and emit a rejection event when a rule blocks them,
///        instead of reverting, so the attempt stays on-chain and the logger can publish it.
///      - `burn` never needs a price.
///      - HBAR amounts are tinybars (8 decimals): on Hedera, msg.value and balances are tinybars.
contract TheReserve is IReserveSource, ReentrancyGuard {
    /// HTS system contract.
    address internal constant HTS = address(0x167);
    /// HTS key type bit for the supply key.
    uint256 internal constant SUPPLY_KEY = 16;
    /// Token auto-renew period: about 91 days, inside Hedera's allowed range.
    int64 internal constant AUTO_RENEW_PERIOD = 7_890_000;
    int32 internal constant TOKEN_DECIMALS = 6;
    /// Lowest ratio the constructor accepts: 110%.
    uint256 public constant MIN_RATIO_FLOOR_BPS = 11_000;

    PriceGuard public immutable priceGuard;
    uint256 public immutable minRatioBps;
    address public immutable deployer;

    /// The HTS token. Zero until createToken() runs.
    address public token;

    mapping(address account => uint256 tinybars) public collateral;
    mapping(address account => uint256 amount) public debt;
    uint256 public totalCollateral;
    uint256 public totalDebt;

    event TokenCreated(address indexed token, string name, string symbol);
    event Deposited(address indexed account, uint256 amountTinybars, uint256 collateralTinybars);
    event Minted(address indexed account, uint256 amount, uint256 price, uint256 debt);
    event MintRejected(address indexed account, uint256 amount, uint8 reasonCode, uint256 price);
    event Burned(address indexed account, uint256 amount, uint256 debt);
    event Withdrawn(address indexed account, uint256 amountTinybars, uint256 price, uint256 collateralTinybars);
    event WithdrawRejected(address indexed account, uint256 amountTinybars, uint8 reasonCode, uint256 price);

    error NotDeployer();
    error TokenAlreadyCreated();
    error TokenNotCreated();
    error ZeroAmount();
    error AmountTooLarge();
    error InsufficientCollateral();
    error BurnExceedsDebt();
    error HtsCallFailed(int64 responseCode);
    error HbarTransferFailed();
    error UseDeposit();
    error InvalidParameter();

    constructor(address priceGuard_, uint256 minRatioBps_) {
        if (priceGuard_ == address(0) || minRatioBps_ < MIN_RATIO_FLOOR_BPS) revert InvalidParameter();
        priceGuard = PriceGuard(priceGuard_);
        minRatioBps = minRatioBps_;
        deployer = msg.sender;
    }

    /// Plain HBAR transfers are refused so every deposit is credited to an account.
    receive() external payable {
        revert UseDeposit();
    }

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    /// Creates the HTS token with this contract as treasury and only supply key, no admin key,
    /// and zero initial supply. Callable once, by the deployer. msg.value pays the HTS creation
    /// fee; anything left over is returned.
    function createToken(string calldata name, string calldata symbol) external payable nonReentrant {
        if (msg.sender != deployer) revert NotDeployer();
        if (token != address(0)) revert TokenAlreadyCreated();

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: SUPPLY_KEY,
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });

        IHederaTokenService.HederaToken memory spec = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: "The Reserve: HBAR-backed, minted only within the collateral ratio",
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({
                second: 0,
                autoRenewAccount: address(this),
                autoRenewPeriod: AUTO_RENEW_PERIOD
            })
        });

        (int64 rc, address created) = IHederaTokenService(HTS).createFungibleToken{ value: msg.value }(
            spec,
            0,
            TOKEN_DECIMALS
        );
        if (rc != HederaResponseCodes.SUCCESS) revert HtsCallFailed(rc);
        token = created;
        emit TokenCreated(created, name, symbol);

        // Collateral is the only HBAR this contract should hold; refund what the fee did not use.
        uint256 spare = address(this).balance - totalCollateral;
        if (spare > 0) _sendHbar(msg.sender, spare);
    }

    // ---------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------

    /// Adds msg.value (tinybars) to the caller's collateral.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        collateral[msg.sender] += msg.value;
        totalCollateral += msg.value;
        emit Deposited(msg.sender, msg.value, collateral[msg.sender]);
    }

    /// Mints `amount` (6 decimals) to the caller if the guarded price is accepted and the caller
    /// stays at or above minRatioBps. Returns false and emits MintRejected otherwise.
    /// The caller must have associated the token first (reason code 6 if not).
    function mint(uint256 amount) external nonReentrant returns (bool) {
        if (token == address(0)) revert TokenNotCreated();
        if (amount == 0) revert ZeroAmount();
        if (amount > uint256(uint64(type(int64).max))) revert AmountTooLarge();

        (bool ok, uint256 price, uint8 code) = priceGuard.getGuardedPrice();
        if (!ok) return _rejectMint(amount, code, price);

        uint256 newDebt = debt[msg.sender] + amount;
        if (!ReserveMath.isHealthy(collateral[msg.sender], newDebt, price, minRatioBps)) {
            return _rejectMint(amount, ReasonCodes.RATIO_TOO_LOW, price);
        }

        // Mint to the treasury (this contract), then send to the caller.
        int64 amount64 = int64(uint64(amount));
        (int64 rc, , ) = IHederaTokenService(HTS).mintToken(token, amount64, new bytes[](0));
        if (rc != HederaResponseCodes.SUCCESS) revert HtsCallFailed(rc);

        rc = IHederaTokenService(HTS).transferToken(token, address(this), msg.sender, amount64);
        if (rc == HederaResponseCodes.TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) {
            // Undo the mint so supply never exceeds recorded debt, and log the refusal.
            _burnFromTreasury(amount64);
            return _rejectMint(amount, ReasonCodes.NOT_ASSOCIATED, price);
        }
        if (rc != HederaResponseCodes.SUCCESS) revert HtsCallFailed(rc);

        debt[msg.sender] = newDebt;
        totalDebt += amount;
        emit Minted(msg.sender, amount, price, newDebt);
        return true;
    }

    /// Returns `amount` tokens and reduces the caller's debt. Needs no price, so it works even when
    /// the guard refuses every price. The caller must first approve this contract for `amount`
    /// on the token (ERC-20 `approve`).
    function burn(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > debt[msg.sender]) revert BurnExceedsDebt();

        int64 rc = IHederaTokenService(HTS).transferFrom(token, msg.sender, address(this), amount);
        if (rc != HederaResponseCodes.SUCCESS) revert HtsCallFailed(rc);
        _burnFromTreasury(int64(uint64(amount)));

        debt[msg.sender] -= amount;
        totalDebt -= amount;
        emit Burned(msg.sender, amount, debt[msg.sender]);
    }

    /// Sends `amountTinybars` of the caller's collateral back if the caller stays at or above
    /// minRatioBps afterwards. With no debt no price is needed. Returns false and emits
    /// WithdrawRejected when a rule blocks it.
    function withdraw(uint256 amountTinybars) external nonReentrant returns (bool) {
        if (amountTinybars == 0) revert ZeroAmount();
        uint256 current = collateral[msg.sender];
        if (amountTinybars > current) revert InsufficientCollateral();

        uint256 price;
        uint256 owed = debt[msg.sender];
        if (owed > 0) {
            bool ok;
            uint8 code;
            (ok, price, code) = priceGuard.getGuardedPrice();
            if (!ok) return _rejectWithdraw(amountTinybars, code, price);
            if (!ReserveMath.isHealthy(current - amountTinybars, owed, price, minRatioBps)) {
                return _rejectWithdraw(amountTinybars, ReasonCodes.RATIO_TOO_LOW, price);
            }
        }

        collateral[msg.sender] = current - amountTinybars;
        totalCollateral -= amountTinybars;
        emit Withdrawn(msg.sender, amountTinybars, price, current - amountTinybars);
        _sendHbar(msg.sender, amountTinybars);
        return true;
    }

    // ---------------------------------------------------------------------
    // Views (at the last accepted price)
    // ---------------------------------------------------------------------

    /// Collateral ratio of `account` in basis points at the last accepted price.
    /// type(uint256).max with no debt; 0 if no price has been accepted yet and there is debt.
    function ratioOf(address account) external view returns (uint256) {
        return ReserveMath.ratioBps(collateral[account], debt[account], priceGuard.lastPrice());
    }

    /// How much `account` could still mint at the last accepted price.
    function maxMintableOf(address account) external view returns (uint256) {
        return ReserveMath.maxMintable(collateral[account], debt[account], priceGuard.lastPrice(), minRatioBps);
    }

    /// One call for the dashboard.
    /// @return collateralTinybars Total HBAR held as collateral, in tinybars.
    /// @return collateralUsd Its USD value (6 decimals) at the last accepted price.
    /// @return supply Total tokens issued (6 decimals); equals the sum of all debt.
    /// @return ratioBps Overall collateral ratio in basis points (max uint if supply is 0).
    /// @return lastPrice Last accepted HBAR/USD price (8 decimals); 0 if none yet.
    /// @return lastPriceAge Seconds since that price was published; 0 if none yet.
    function reserveSummary()
        external
        view
        returns (
            uint256 collateralTinybars,
            uint256 collateralUsd,
            uint256 supply,
            uint256 ratioBps,
            uint256 lastPrice,
            uint256 lastPriceAge
        )
    {
        lastPrice = priceGuard.lastPrice();
        uint256 updatedAt = priceGuard.lastUpdatedAt();
        collateralTinybars = totalCollateral;
        collateralUsd = ReserveMath.usdValue(totalCollateral, lastPrice);
        supply = totalDebt;
        ratioBps = ReserveMath.ratioBps(totalCollateral, totalDebt, lastPrice);
        lastPriceAge = updatedAt == 0 || updatedAt > block.timestamp ? 0 : block.timestamp - updatedAt;
    }

    /// @inheritdoc IReserveSource
    function reserveValueUsd(address account) external view returns (uint256) {
        return ReserveMath.usdValue(collateral[account], priceGuard.lastPrice());
    }

    /// @inheritdoc IReserveSource
    function totalReserveValueUsd() external view returns (uint256) {
        return ReserveMath.usdValue(totalCollateral, priceGuard.lastPrice());
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _rejectMint(uint256 amount, uint8 code, uint256 price) internal returns (bool) {
        emit MintRejected(msg.sender, amount, code, price);
        return false;
    }

    function _rejectWithdraw(uint256 amountTinybars, uint8 code, uint256 price) internal returns (bool) {
        emit WithdrawRejected(msg.sender, amountTinybars, code, price);
        return false;
    }

    function _burnFromTreasury(int64 amount) internal {
        (int64 rc, ) = IHederaTokenService(HTS).burnToken(token, amount, new int64[](0));
        if (rc != HederaResponseCodes.SUCCESS) revert HtsCallFailed(rc);
    }

    function _sendHbar(address to, uint256 tinybars) internal {
        (bool sent, ) = payable(to).call{ value: tinybars }("");
        if (!sent) revert HbarTransferFailed();
    }
}
