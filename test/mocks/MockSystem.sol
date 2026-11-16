// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";

/// @notice Stand-in for Reactive's system contract. Tests etch it at 0x8888…8888.
/// @dev Keeps a real subscription registry with wildcard matching and emits the same
///      `CallbackRequest` event as the live system contract, so tests exercise the same
///      subscribe / react / requestCallback path as the network.
contract MockSystem {
    uint256 internal constant REACTIVE_IGNORE =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    /// @dev Same shape as the live system contract's event, which is what the network acts on.
    event CallbackRequest(
        uint256 indexed chainId,
        address indexed sender,
        address indexed recipient,
        ISystemContract.CallbackVersion version,
        bytes configuration
    );

    mapping(bytes32 => bool) public live;
    uint256 public liveCount;
    uint256 public totalCallbacks;

    receive() external payable {}

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 t0_,
        uint256 t1_,
        uint256 t2_,
        uint256 t3_
    ) external {
        bytes32 key = _key(msg.sender, chainId_, contract_, t0_, t1_, t2_, t3_);
        if (!live[key]) {
            live[key] = true;
            liveCount++;
        }
    }

    function unsubscribe(
        uint256 chainId_,
        address contract_,
        uint256 t0_,
        uint256 t1_,
        uint256 t2_,
        uint256 t3_
    ) external {
        bytes32 key = _key(msg.sender, chainId_, contract_, t0_, t1_, t2_, t3_);
        if (live[key]) {
            live[key] = false;
            liveCount--;
        }
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        totalCallbacks++;
        emit CallbackRequest(
            config_.chainId,
            msg.sender,
            config_.recipient,
            ISystemContract.CallbackVersion.V_1_0,
            abi.encode(config_)
        );
    }

    function requestCallback(ISystemContract.CallbackVersion version_, bytes memory config_) external {
        ISystemContract.CallbackConfiguration_V_1_0 memory c =
            abi.decode(config_, (ISystemContract.CallbackConfiguration_V_1_0));
        totalCallbacks++;
        emit CallbackRequest(c.chainId, msg.sender, c.recipient, version_, config_);
    }

    // ── test helpers ──

    function isSubscribed(
        address subscriber_,
        uint256 chainId_,
        address contract_,
        uint256 t0_,
        uint256 t1_,
        uint256 t2_,
        uint256 t3_
    ) external view returns (bool) {
        return live[_key(subscriber_, chainId_, contract_, t0_, t1_, t2_, t3_)];
    }

    /// @notice Would the network deliver this log to `subscriber_`? Tries every wildcard combination.
    function matches(address subscriber_, IReactive.LogRecord memory log_) external view returns (bool) {
        for (uint256 mask = 0; mask < 64; mask++) {
            bytes32 key = _key(
                subscriber_,
                mask & 1 == 0 ? log_.chainId : 0,
                mask & 2 == 0 ? log_.contractAddress : address(0),
                mask & 4 == 0 ? log_.topic0 : REACTIVE_IGNORE,
                mask & 8 == 0 ? log_.topic1 : REACTIVE_IGNORE,
                mask & 16 == 0 ? log_.topic2 : REACTIVE_IGNORE,
                mask & 32 == 0 ? log_.topic3 : REACTIVE_IGNORE
            );
            if (live[key]) return true;
        }
        return false;
    }

    function _key(
        address subscriber_,
        uint256 chainId_,
        address contract_,
        uint256 t0_,
        uint256 t1_,
        uint256 t2_,
        uint256 t3_
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(subscriber_, chainId_, contract_, t0_, t1_, t2_, t3_));
    }
}
