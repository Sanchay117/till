// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {ForwarderFactory} from "./ForwarderFactory.sol";

/// @title InvoiceBook
/// @notice The books. Lives on one home chain. Anyone can create an invoice; each invoice gets a
///         deposit address that is the same on every supported chain. When money lands there, on any
///         of those chains, Reactive calls `recordPayment()` and the invoice marks itself paid.
/// @dev This contract never holds invoice funds. Its balance only pays for callback gas.
contract InvoiceBook is AbstractCallback {
    error NotOwner();
    error NotSeller();
    error NotOpen();
    error UnknownInvoice();
    error BadAmount();
    error BadPayTo();
    error BadExpiry();
    error MemoTooLong();

    enum Status {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address seller; // who created the invoice
        address payTo; // where the money is swept to, e.g. a cold wallet
        address depositAddress; // where the payer sends tokens, on any supported chain
        uint128 amount; // amount due, in token base units (USDC has 6 decimals)
        uint128 received; // total seen so far, across all chains
        uint40 createdAt;
        uint40 expiresAt;
        uint40 paidAt; // home-chain time of the callback that settled it
        Status status;
        address payer; // sender of the payment that settled it
        uint64 paidOnChain; // chain id the settling payment landed on
        string memo;
    }

    /// @dev TillReactive subscribes to this event. Changing it means changing the reactive contract.
    event InvoiceCreated(
        bytes32 indexed id,
        address indexed seller,
        address indexed depositAddress,
        address payTo,
        uint256 amount,
        uint256 expiresAt,
        string memo
    );
    /// @dev TillReactive subscribes to this event too.
    event InvoiceCancelled(bytes32 indexed id);
    event PaymentRecorded(
        bytes32 indexed id,
        uint256 indexed chainId,
        address indexed payer,
        uint256 amount,
        uint256 totalReceived,
        bytes32 originTxHash
    );
    event InvoicePaid(
        bytes32 indexed id,
        uint256 indexed chainId,
        address indexed payer,
        uint256 totalReceived,
        bytes32 originTxHash
    );

    uint256 public constant MAX_MEMO_BYTES = 140;
    uint256 public constant MAX_LIFETIME = 90 days;

    ForwarderFactory public immutable FACTORY;
    address public immutable OWNER;

    mapping(bytes32 id => Invoice) private _invoices;
    mapping(address seller => bytes32[]) private _invoicesOf;
    uint256 public invoiceCount;

    /// @param callbackProxy_ Reactive's callback proxy on this chain.
    /// @param reactive_ The TillReactive contract on Reactive Network, the only authorized sender.
    /// @param factory_ The ForwarderFactory on this chain (same address on every chain).
    constructor(IPayable callbackProxy_, address reactive_, ForwarderFactory factory_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
    {
        FACTORY = factory_;
        OWNER = msg.sender;
    }

    // ───────────────────────────── Sellers ─────────────────────────────

    /// @notice Create an invoice.
    /// @param payTo_ Where the money should end up. The deposit address can only ever pay this address.
    /// @param amount_ Amount due in token base units (1 USDC = 1_000_000).
    /// @param expiresAt_ Unix time after which Till may stop watching for payment.
    /// @param memo_ Short note shown to the payer, 140 bytes at most.
    /// @return id_ The invoice id.
    /// @return depositAddress_ Where the payer sends tokens, on any supported chain.
    function createInvoice(address payTo_, uint256 amount_, uint256 expiresAt_, string calldata memo_)
        external
        returns (bytes32 id_, address depositAddress_)
    {
        if (payTo_ == address(0)) revert BadPayTo();
        if (amount_ == 0 || amount_ > type(uint128).max) revert BadAmount();
        if (expiresAt_ <= block.timestamp || expiresAt_ > block.timestamp + MAX_LIFETIME) revert BadExpiry();
        if (bytes(memo_).length > MAX_MEMO_BYTES) revert MemoTooLong();

        id_ = keccak256(abi.encode(block.chainid, address(this), msg.sender, invoiceCount));
        depositAddress_ = FACTORY.depositAddress(payTo_, id_);
        invoiceCount++;

        Invoice storage inv = _invoices[id_];
        inv.seller = msg.sender;
        inv.payTo = payTo_;
        inv.depositAddress = depositAddress_;
        inv.amount = uint128(amount_);
        inv.createdAt = uint40(block.timestamp);
        inv.expiresAt = uint40(expiresAt_);
        inv.status = Status.Open;
        inv.memo = memo_;
        _invoicesOf[msg.sender].push(id_);

        emit InvoiceCreated(id_, msg.sender, depositAddress_, payTo_, amount_, expiresAt_, memo_);
    }

    /// @notice Cancel an open invoice. Till stops watching its deposit address.
    /// @dev Money that still arrives is not lost: anyone can call `FACTORY.flush()` to send it to `payTo`.
    function cancelInvoice(bytes32 id_) external {
        Invoice storage inv = _invoices[id_];
        if (inv.seller != msg.sender) revert NotSeller();
        if (inv.status != Status.Open) revert NotOpen();
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id_);
    }

    // ───────────────────────────── Reactive callback ─────────────────────────────

    /// @notice Callback from Reactive: a payment landed at the invoice's deposit address.
    /// @param reactive_ Filled in by the callback proxy with the requesting reactive contract.
    /// @param id_ Invoice id.
    /// @param chainId_ Chain the payment landed on.
    /// @param payer_ Who sent it.
    /// @param amount_ How much, in token base units.
    /// @param originTxHash_ The payment's transaction hash on `chainId_`.
    function recordPayment(
        address reactive_,
        bytes32 id_,
        uint256 chainId_,
        address payer_,
        uint256 amount_,
        uint256 originTxHash_
    ) external onlyServiceProvider onlyCallbackSender(reactive_) {
        Invoice storage inv = _invoices[id_];
        if (inv.status == Status.None) revert UnknownInvoice();

        uint256 total = uint256(inv.received) + amount_;
        if (total > type(uint128).max) total = type(uint128).max;
        inv.received = uint128(total);
        emit PaymentRecorded(id_, chainId_, payer_, amount_, total, bytes32(originTxHash_));

        // A payment can race a cancellation. The money still reaches the seller, so the books say paid.
        if (inv.status != Status.Paid && total >= inv.amount) {
            inv.status = Status.Paid;
            inv.paidAt = uint40(block.timestamp);
            inv.payer = payer_;
            inv.paidOnChain = uint64(chainId_);
            emit InvoicePaid(id_, chainId_, payer_, total, bytes32(originTxHash_));
        }
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getInvoice(bytes32 id_) external view returns (Invoice memory) {
        return _invoices[id_];
    }

    function invoiceCountOf(address seller_) external view returns (uint256) {
        return _invoicesOf[seller_].length;
    }

    /// @notice A page of a seller's invoice ids, oldest first.
    function invoicesOf(address seller_, uint256 offset_, uint256 limit_)
        external
        view
        returns (bytes32[] memory page_)
    {
        bytes32[] storage all = _invoicesOf[seller_];
        if (offset_ >= all.length) return new bytes32[](0);
        uint256 end = offset_ + limit_;
        if (end > all.length) end = all.length;
        page_ = new bytes32[](end - offset_);
        for (uint256 i = offset_; i < end; i++) {
            page_[i - offset_] = all[i];
        }
    }

    // ───────────────────────────── Gas money ─────────────────────────────

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
