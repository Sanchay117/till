// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";

/// @title TillReactive
/// @notice The part of Till that lives on Reactive Network. It is the whole back end.
///
///         1. An invoice is created on the home chain. This contract hears `InvoiceCreated` and starts
///            watching the invoice's deposit address on every pay chain, by subscribing at runtime to
///            ERC-20 `Transfer` logs whose recipient is that address. The address has no code yet.
///         2. Money lands at the deposit address on any pay chain. This contract hears the `Transfer`,
///            adds it up, and requests two callbacks from the one event:
///              - to the home chain, so the invoice marks itself paid, and
///              - to the chain the money landed on, so it is swept to the seller.
///         3. Once the invoice is settled, cancelled or expired, it unsubscribes, so an idle Till
///            costs nothing.
contract TillReactive is AbstractReactive {
    error NotOwner();
    error HomeAlreadySet();
    error ZeroAddress();
    error ChainAlreadyAdded();
    error TooManyChains();

    event HomeSet(uint256 indexed chainId, address indexed invoiceBook);
    event PayChainAdded(uint256 indexed chainId, address indexed token, address indexed collector);
    event PausedSet(bool paused);
    event Watching(
        bytes32 indexed invoiceId, address indexed depositAddress, uint256 amount, uint256 expiresAt
    );
    event PaymentSeen(
        bytes32 indexed invoiceId,
        uint256 indexed chainId,
        address indexed payer,
        uint256 amount,
        uint256 totalReceived,
        bool settled,
        uint256 originTxHash
    );
    event Unwatched(bytes32 indexed invoiceId, address indexed depositAddress, Reason reason);

    enum Reason {
        Settled,
        Cancelled,
        Expired
    }

    struct PayChain {
        uint256 chainId;
        address token; // the stablecoin accepted on this chain
        address collector; // Till's Collector on this chain
    }

    struct Watch {
        bytes32 invoiceId;
        address payTo;
        uint128 amount; // amount due
        uint128 received; // total seen across all pay chains
        uint40 expiresAt;
        uint8 chains; // how many pay chains were subscribed when the watch began
        bool active; // subscriptions are live
        uint64 watchedBlock; // Reactive block of the react() that began the watch
        uint64 seenBlock; // Reactive block of the latest react() that counted a payment
    }

    uint256 private constant TRANSFER_TOPIC0 = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant INVOICE_CREATED_TOPIC0 =
        uint256(keccak256("InvoiceCreated(bytes32,address,address,address,uint256,uint256,string)"));
    uint256 private constant INVOICE_CANCELLED_TOPIC0 = uint256(keccak256("InvoiceCancelled(bytes32)"));

    /// @dev Bounds the loops in `react()`, which must fit in Reactive's 900,000 gas cap.
    uint256 public constant MAX_PAY_CHAINS = 6;
    /// @dev Transfers smaller than amount / DUST_DIVISOR are ignored, so nobody can make Till pay for
    ///      callbacks by sending dust. Dust still reaches the seller on the next sweep.
    uint256 public constant DUST_DIVISOR = 100;
    /// @dev Callback gas limits. A callback proxy keeps up to about 200,000 of the limit for its own
    ///      accounting (`_extraGas` + `_maxChargeGas`), so these leave room above what the calls use.
    uint64 public constant RECORD_GAS_LIMIT = 400_000;
    uint64 public constant SWEEP_GAS_LIMIT = 600_000;

    address public immutable OWNER;

    uint256 public homeChainId;
    address public invoiceBook;
    bool public paused;

    PayChain[] private _payChains;
    mapping(uint256 chainId => uint256 indexPlusOne) private _payChainIndex;

    mapping(address depositAddress => Watch) public watches;
    mapping(bytes32 invoiceId => address depositAddress) public depositOf;
    mapping(bytes32 logKey => bool) private _seen;

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    /// @dev `payable` so the contract can be funded with REACT at deployment.
    constructor() payable {
        OWNER = msg.sender;
    }

    // ───────────────────────────── Setup (owner) ─────────────────────────────

    /// @notice Point Till at its InvoiceBook and start listening for new and cancelled invoices.
    /// @dev Set once. The InvoiceBook is deployed after this contract because it needs this address.
    function setHome(uint256 chainId_, address invoiceBook_) external onlyOwner {
        if (invoiceBook != address(0)) revert HomeAlreadySet();
        if (invoiceBook_ == address(0)) revert ZeroAddress();
        homeChainId = chainId_;
        invoiceBook = invoiceBook_;

        SYSTEM.subscribe(
            chainId_, invoiceBook_, INVOICE_CREATED_TOPIC0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            chainId_,
            invoiceBook_,
            INVOICE_CANCELLED_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        emit HomeSet(chainId_, invoiceBook_);
    }

    /// @notice Accept payment on another chain. Applies to invoices created from now on.
    function addPayChain(uint256 chainId_, address token_, address collector_) external onlyOwner {
        if (token_ == address(0) || collector_ == address(0)) revert ZeroAddress();
        if (_payChainIndex[chainId_] != 0) revert ChainAlreadyAdded();
        if (_payChains.length == MAX_PAY_CHAINS) revert TooManyChains();

        _payChains.push(PayChain({chainId: chainId_, token: token_, collector: collector_}));
        _payChainIndex[chainId_] = _payChains.length;
        emit PayChainAdded(chainId_, token_, collector_);
    }

    /// @notice Stop taking on new invoices. Invoices already being watched still settle.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // ───────────────────────────── The reactive part ─────────────────────────────

    /// @inheritdoc IReactive
    /// @dev Never reverts on a log it does not care about: a revert is still billed.
    function react(LogRecord calldata log_) external onlySystem {
        if (log_.topic0 == TRANSFER_TOPIC0) {
            _onTransfer(log_);
        } else if (log_.chainId == homeChainId && log_.contractAddress == invoiceBook) {
            if (log_.topic0 == INVOICE_CREATED_TOPIC0) {
                _onInvoiceCreated(log_);
            } else if (log_.topic0 == INVOICE_CANCELLED_TOPIC0) {
                _onInvoiceCancelled(log_);
            }
        }
    }

    /// @dev A new invoice: remember it and watch its deposit address on every pay chain.
    function _onInvoiceCreated(LogRecord calldata log_) private {
        if (paused || log_.opCode != 4) return;

        bytes32 invoiceId = bytes32(log_.topic1);
        address depositAddress = address(uint160(log_.topic3));
        if (depositOf[invoiceId] != address(0) || watches[depositAddress].invoiceId != bytes32(0)) return;

        // The memo string that follows in the data is not needed here, so it is not decoded.
        (address payTo, uint256 amount, uint256 expiresAt) =
            abi.decode(log_.data, (address, uint256, uint256));

        uint256 chains = _payChains.length;
        watches[depositAddress] = Watch({
            invoiceId: invoiceId,
            payTo: payTo,
            amount: uint128(amount),
            received: 0,
            expiresAt: uint40(expiresAt),
            chains: uint8(chains),
            active: true,
            watchedBlock: uint64(block.number),
            seenBlock: 0
        });
        depositOf[invoiceId] = depositAddress;

        for (uint256 i = 0; i < chains; i++) {
            PayChain storage pc = _payChains[i];
            SYSTEM.subscribe(
                pc.chainId,
                pc.token,
                TRANSFER_TOPIC0,
                REACTIVE_IGNORE,
                _topic(depositAddress),
                REACTIVE_IGNORE
            );
        }
        emit Watching(invoiceId, depositAddress, amount, expiresAt);
    }

    /// @dev The seller cancelled: stop watching.
    function _onInvoiceCancelled(LogRecord calldata log_) private {
        address depositAddress = depositOf[bytes32(log_.topic1)];
        if (depositAddress == address(0)) return;
        _unwatch(depositAddress, Reason.Cancelled);
    }

    /// @dev Money landed at a watched deposit address.
    function _onTransfer(LogRecord calldata log_) private {
        // A standard ERC-20 Transfer has exactly three topics, with the amount alone in the data.
        if (log_.opCode != 3 || log_.data.length != 32) return;

        uint256 index = _payChainIndex[log_.chainId];
        if (index == 0) return;
        PayChain storage pc = _payChains[index - 1];
        if (pc.token != log_.contractAddress) return;

        address depositAddress = address(uint160(log_.topic2));
        Watch storage watch = watches[depositAddress];
        if (watch.invoiceId == bytes32(0)) return;

        uint256 amount = abi.decode(log_.data, (uint256));
        if (amount == 0 || amount < watch.amount / DUST_DIVISOR) return;

        // Each log counts once, even if it is ever delivered twice.
        bytes32 logKey = keccak256(abi.encode(log_.chainId, log_.txHash, log_.logIndex));
        if (_seen[logKey]) return;
        _seen[logKey] = true;

        uint256 total = uint256(watch.received) + amount;
        if (total > type(uint128).max) total = type(uint128).max;
        watch.received = uint128(total);
        watch.seenBlock = uint64(block.number);

        _requestRecord(watch.invoiceId, log_, amount);
        _requestSweep(log_.chainId, pc, watch);
        emit PaymentSeen(
            watch.invoiceId,
            log_.chainId,
            address(uint160(log_.topic1)),
            amount,
            total,
            total >= watch.amount,
            log_.txHash
        );

        if (total >= watch.amount) _unwatch(depositAddress, Reason.Settled);
    }

    /// @dev Callback 1, to the home chain: the invoice marks itself paid.
    function _requestRecord(bytes32 invoiceId_, LogRecord calldata log_, uint256 amount_) private {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: homeChainId,
                recipient: invoiceBook,
                gasLimit: RECORD_GAS_LIMIT,
                payload: abi.encodeWithSignature(
                    "recordPayment(address,bytes32,uint256,address,uint256,uint256)",
                    address(0), // replaced by the callback proxy with this contract's address
                    invoiceId_,
                    log_.chainId,
                    address(uint160(log_.topic1)), // the payer
                    amount_,
                    log_.txHash
                )
            })
        );
    }

    /// @dev Callback 2, to the chain the money landed on: sweep it to the seller.
    function _requestSweep(uint256 chainId_, PayChain storage pc_, Watch storage watch_) private {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: chainId_,
                recipient: pc_.collector,
                gasLimit: SWEEP_GAS_LIMIT,
                payload: abi.encodeWithSignature(
                    "sweep(address,address,bytes32,address)",
                    address(0), // replaced by the callback proxy with this contract's address
                    watch_.payTo,
                    watch_.invoiceId,
                    pc_.token
                )
            })
        );
    }

    /// @dev Drops every subscription for a deposit address. Safe to call twice.
    function _unwatch(address depositAddress_, Reason reason_) private {
        Watch storage watch = watches[depositAddress_];
        if (!watch.active) return;
        watch.active = false;

        uint256 chains = watch.chains;
        for (uint256 i = 0; i < chains; i++) {
            PayChain storage pc = _payChains[i];
            SYSTEM.unsubscribe(
                pc.chainId,
                pc.token,
                TRANSFER_TOPIC0,
                REACTIVE_IGNORE,
                _topic(depositAddress_),
                REACTIVE_IGNORE
            );
        }
        emit Unwatched(watch.invoiceId, depositAddress_, reason_);
    }

    function _topic(address a_) private pure returns (uint256) {
        return uint256(uint160(a_));
    }

    // ───────────────────────────── Housekeeping (anyone) ─────────────────────────────

    /// @notice Stop watching invoices that have expired unpaid. Anyone may call this.
    /// @dev Money that arrives later is not lost: anyone can flush the deposit address to the seller.
    function prune(address[] calldata depositAddresses_) external {
        for (uint256 i = 0; i < depositAddresses_.length; i++) {
            Watch storage watch = watches[depositAddresses_[i]];
            if (watch.active && block.timestamp > watch.expiresAt) {
                _unwatch(depositAddresses_[i], Reason.Expired);
            }
        }
    }

    /// @notice Settles any debt to the system contract from this contract's balance. Open to anyone,
    ///         so anyone can top Till up and restart it.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Lets the owner take back unused REACT.
    function withdraw(uint256 amount_) external onlyOwner {
        _pay(payable(OWNER), amount_);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function payChains() external view returns (PayChain[] memory) {
        return _payChains;
    }
}
