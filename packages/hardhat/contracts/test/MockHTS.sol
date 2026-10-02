// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "../interfaces/IHederaTokenService.sol";

/// Test-only stand-in for the HTS system contract. Tests install its runtime code at 0x167 with
/// hardhat_setCode, so production contracts keep calling the real system address.
/// It models the rules The Reserve depends on: only the supply key can mint and burn, mint and
/// burn act on the treasury, receivers must be associated, and transferFrom needs an allowance.
contract MockHTS is IHederaTokenService {
    int64 internal constant SUCCESS = 22;
    int64 internal constant INVALID_SIGNATURE = 7;
    int64 internal constant INSUFFICIENT_TOKEN_BALANCE = 178;
    int64 internal constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
    int64 internal constant SPENDER_DOES_NOT_HAVE_ALLOWANCE = 292;
    int64 internal constant INVALID_TOKEN_ID = 167;

    mapping(address token => address supplyKey) public supplyKeyOf;
    mapping(address token => address treasury) public treasuryOf;

    function createFungibleToken(
        HederaToken memory spec,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64, address) {
        address supplyKey;
        for (uint256 i = 0; i < spec.tokenKeys.length; i++) {
            if (spec.tokenKeys[i].keyType & 16 != 0) supplyKey = spec.tokenKeys[i].key.contractId;
        }
        MockHtsToken created = new MockHtsToken(spec.name, spec.symbol, uint8(uint32(decimals)), spec.treasury);
        supplyKeyOf[address(created)] = supplyKey;
        treasuryOf[address(created)] = spec.treasury;
        if (initialTotalSupply > 0) created.htsMint(spec.treasury, uint256(uint64(initialTotalSupply)));
        return (SUCCESS, address(created));
    }

    function mintToken(address token, int64 amount, bytes[] memory) external returns (int64, int64, int64[] memory) {
        if (treasuryOf[token] == address(0)) return (INVALID_TOKEN_ID, 0, new int64[](0));
        if (msg.sender != supplyKeyOf[token]) return (INVALID_SIGNATURE, 0, new int64[](0));
        MockHtsToken(token).htsMint(treasuryOf[token], uint256(uint64(amount)));
        return (SUCCESS, int64(uint64(MockHtsToken(token).totalSupply())), new int64[](0));
    }

    function burnToken(address token, int64 amount, int64[] memory) external returns (int64, int64) {
        if (treasuryOf[token] == address(0)) return (INVALID_TOKEN_ID, 0);
        if (msg.sender != supplyKeyOf[token]) return (INVALID_SIGNATURE, 0);
        MockHtsToken t = MockHtsToken(token);
        if (t.balanceOf(treasuryOf[token]) < uint256(uint64(amount))) return (INSUFFICIENT_TOKEN_BALANCE, 0);
        t.htsBurn(treasuryOf[token], uint256(uint64(amount)));
        return (SUCCESS, int64(uint64(t.totalSupply())));
    }

    function transferToken(address token, address sender, address recipient, int64 amount) external returns (int64) {
        if (treasuryOf[token] == address(0)) return INVALID_TOKEN_ID;
        if (msg.sender != sender) return INVALID_SIGNATURE;
        return _move(MockHtsToken(token), sender, recipient, uint256(uint64(amount)));
    }

    function transferFrom(address token, address from, address to, uint256 amount) external returns (int64) {
        if (treasuryOf[token] == address(0)) return INVALID_TOKEN_ID;
        MockHtsToken t = MockHtsToken(token);
        if (t.allowance(from, msg.sender) < amount) return SPENDER_DOES_NOT_HAVE_ALLOWANCE;
        int64 rc = _move(t, from, to, amount);
        if (rc == SUCCESS) t.htsSpendAllowance(from, msg.sender, amount);
        return rc;
    }

    function _move(MockHtsToken t, address from, address to, uint256 amount) internal returns (int64) {
        if (!t.associated(to)) return TOKEN_NOT_ASSOCIATED_TO_ACCOUNT;
        if (t.balanceOf(from) < amount) return INSUFFICIENT_TOKEN_BALANCE;
        t.htsMove(from, to, amount);
        return SUCCESS;
    }
}

/// Test-only ERC-20 facade for an HTS token, including HIP-719 associate().
/// Only the mock system contract that created it can mint, burn or move balances directly.
contract MockHtsToken {
    address public immutable hts;
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public associated;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyHts() {
        require(msg.sender == hts, "only HTS");
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address treasury) {
        hts = msg.sender;
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        associated[treasury] = true; // the treasury is associated on creation
    }

    // HIP-719 facade

    function associate() external returns (int64) {
        associated[msg.sender] = true;
        return 22;
    }

    function isAssociated() external view returns (bool) {
        return associated[msg.sender];
    }

    // ERC-20 facade

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(associated[to], "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_TOKEN_BALANCE");
        _move(msg.sender, to, amount);
        return true;
    }

    // Hooks for the mock system contract

    function htsMint(address to, uint256 amount) external onlyHts {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function htsBurn(address from, uint256 amount) external onlyHts {
        totalSupply -= amount;
        balanceOf[from] -= amount;
        emit Transfer(from, address(0), amount);
    }

    function htsMove(address from, address to, uint256 amount) external onlyHts {
        _move(from, to, amount);
    }

    function htsSpendAllowance(address owner, address spender, uint256 amount) external onlyHts {
        allowance[owner][spender] -= amount;
    }

    function _move(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
