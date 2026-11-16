// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {ForwarderFactory} from "./ForwarderFactory.sol";

/// @title Collector
/// @notice One per chain that Till accepts payment on. When the reactive contract sees money land at
///         an invoice's deposit address, it calls `sweep()` here, and the money moves to the seller.
/// @dev This contract never holds invoice funds. It only pays for the callback's gas.
contract Collector is AbstractCallback {
    error NotOwner();

    event Swept(bytes32 indexed invoiceId, address indexed token, address indexed payTo, uint256 amount);

    ForwarderFactory public immutable FACTORY;
    address public immutable OWNER;

    /// @param callbackProxy_ Reactive's callback proxy on this chain.
    /// @param reactive_ The TillReactive contract on Reactive Network, the only authorized sender.
    /// @param factory_ The ForwarderFactory on this chain.
    constructor(IPayable callbackProxy_, address reactive_, ForwarderFactory factory_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
    {
        FACTORY = factory_;
        OWNER = msg.sender;
    }

    /// @notice Callback from Reactive: move an invoice's payment from its deposit address to the seller.
    /// @param reactive_ Filled in by the callback proxy with the requesting reactive contract.
    function sweep(address reactive_, address payTo_, bytes32 invoiceId_, address token_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        uint256 amount = FACTORY.flush(payTo_, invoiceId_, token_);
        emit Swept(invoiceId_, token_, payTo_, amount);
    }

    /// @notice Settles any debt to the callback proxy from this contract's balance. Open to anyone.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Lets the owner take back unused gas money.
    function withdraw(uint256 amount_) external {
        if (msg.sender != OWNER) revert NotOwner();
        _pay(payable(OWNER), amount_);
    }
}
