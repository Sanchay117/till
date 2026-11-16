// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
}

/// @title Forwarder
/// @notice Lives at one invoice's deposit address. It can only ever send tokens to `PAY_TO`,
///         so anyone may call `flush()` and nobody can redirect the money.
contract Forwarder {
    error TransferFailed();

    /// @notice The only address this forwarder will ever pay.
    address public immutable PAY_TO;

    constructor(address payTo_) {
        PAY_TO = payTo_;
    }

    /// @notice Sends this address's whole balance of `token_` to `PAY_TO`.
    /// @return amount_ How much was sent.
    function flush(address token_) external returns (uint256 amount_) {
        amount_ = IERC20Minimal(token_).balanceOf(address(this));
        if (amount_ == 0) return 0;

        // Low-level call so tokens that return nothing (USDT-style) work too.
        (bool ok, bytes memory ret) =
            token_.call(abi.encodeWithSignature("transfer(address,uint256)", PAY_TO, amount_));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}

/// @title ForwarderFactory
/// @notice Derives and deploys per-invoice deposit addresses.
/// @dev Deployed with the same salt through the deterministic CREATE2 deployer on every chain, so it
///      has the same address everywhere. A deposit address depends only on this factory's address,
///      the invoice id and `payTo`, so one invoice has one deposit address on every chain, and the
///      address is known before any contract exists there. Everything here is permissionless: the
///      worst a stranger can do is pay the seller sooner.
contract ForwarderFactory {
    event Flushed(bytes32 indexed invoiceId, address indexed token, address indexed payTo, uint256 amount);

    /// @notice The deposit address for an invoice. Has no code until the first flush.
    function depositAddress(address payTo_, bytes32 invoiceId_) public view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(Forwarder).creationCode, abi.encode(payTo_)));
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), invoiceId_, initCodeHash)))
            )
        );
    }

    /// @notice Deploys the invoice's forwarder if needed, then sends its `token_` balance to `payTo_`.
    /// @return amount_ How much was sent.
    function flush(address payTo_, bytes32 invoiceId_, address token_) external returns (uint256 amount_) {
        address forwarder = depositAddress(payTo_, invoiceId_);
        if (forwarder.code.length == 0) {
            new Forwarder{salt: invoiceId_}(payTo_);
        }
        amount_ = Forwarder(forwarder).flush(token_);
        emit Flushed(invoiceId_, token_, payTo_, amount_);
    }
}
