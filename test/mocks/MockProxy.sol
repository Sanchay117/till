// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Stand-in for a destination chain's callback proxy.
/// @dev Like the real proxy, it overwrites the payload's first argument with the address of the
///      reactive contract that requested the callback, then calls the recipient.
contract MockProxy {
    event Delivered(address indexed recipient, bool ok, bytes returnData);

    receive() external payable {}

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function deliver(address recipient_, bytes memory payload_, address sender_, uint64 gasLimit_)
        external
        returns (bool ok_, bytes memory ret_)
    {
        require(payload_.length >= 36, "payload too short");
        assembly {
            // bytes 0..3 are the selector; the first argument is the 32-byte word that follows.
            mstore(add(payload_, 36), sender_)
        }
        (ok_, ret_) = recipient_.call{gas: gasLimit_}(payload_);
        emit Delivered(recipient_, ok_, ret_);
    }
}
