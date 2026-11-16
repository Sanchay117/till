// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Minimal 6-decimal ERC-20 with an open mint, standing in for testnet USDC.
contract MockUSDC {
    string public constant name = "USD Coin (test)";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to_, uint256 amount_) external {
        totalSupply += amount_;
        balanceOf[to_] += amount_;
        emit Transfer(address(0), to_, amount_);
    }

    function approve(address spender_, uint256 amount_) external returns (bool) {
        allowance[msg.sender][spender_] = amount_;
        emit Approval(msg.sender, spender_, amount_);
        return true;
    }

    function transfer(address to_, uint256 amount_) external returns (bool) {
        _transfer(msg.sender, to_, amount_);
        return true;
    }

    function transferFrom(address from_, address to_, uint256 amount_) external returns (bool) {
        allowance[from_][msg.sender] -= amount_;
        _transfer(from_, to_, amount_);
        return true;
    }

    function _transfer(address from_, address to_, uint256 amount_) internal {
        balanceOf[from_] -= amount_;
        balanceOf[to_] += amount_;
        emit Transfer(from_, to_, amount_);
    }
}

/// @notice A token whose `transfer` returns nothing, like mainnet USDT.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function mint(address to_, uint256 amount_) external {
        balanceOf[to_] += amount_;
        emit Transfer(address(0), to_, amount_);
    }

    function transfer(address to_, uint256 amount_) external {
        balanceOf[msg.sender] -= amount_;
        balanceOf[to_] += amount_;
        emit Transfer(msg.sender, to_, amount_);
    }
}

/// @notice A token whose `transfer` returns false instead of reverting.
contract FalseReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to_, uint256 amount_) external {
        balanceOf[to_] += amount_;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}
