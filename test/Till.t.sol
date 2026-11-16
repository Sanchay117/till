// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";

import {TillReactive} from "../src/TillReactive.sol";
import {InvoiceBook} from "../src/InvoiceBook.sol";
import {Collector} from "../src/Collector.sol";
import {ForwarderFactory, Forwarder} from "../src/ForwarderFactory.sol";

import {MockSystem} from "./mocks/MockSystem.sol";
import {MockProxy} from "./mocks/MockProxy.sol";
import {MockUSDC, NoReturnToken, FalseReturnToken} from "./mocks/MockTokens.sol";

/// @notice Runs the whole Till loop in one EVM: three pretend chains, a system contract with a real
///         subscription registry, and callback proxies that inject the sender like the live ones.
contract TillTest is Test {
    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;
    uint256 internal constant IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 internal constant TRANSFER_TOPIC0 = uint256(keccak256("Transfer(address,address,uint256)"));
    bytes32 internal constant CALLBACK_REQUEST_TOPIC0 =
        keccak256("CallbackRequest(uint256,address,address,uint8,bytes)");

    uint256 internal constant HOME = 84532; // Base Sepolia
    uint256 internal constant UNI = 1301; // Unichain Sepolia
    uint256 internal constant SEP = 11155111; // Ethereum Sepolia

    uint256 internal constant USDC = 1e6;

    MockSystem internal sys;
    ForwarderFactory internal factory;
    TillReactive internal till;
    InvoiceBook internal book;

    mapping(uint256 chainId => MockProxy) internal proxyOf;
    mapping(uint256 chainId => MockUSDC) internal usdcOf;
    mapping(uint256 chainId => Collector) internal collectorOf;
    mapping(address emitter => uint256 chainId) internal chainOf;

    address internal seller = makeAddr("seller");
    address internal coldWallet = makeAddr("coldWallet");
    address internal payer = makeAddr("payer");
    address internal stranger = makeAddr("stranger");

    uint256 internal txNonce;

    function setUp() public {
        vm.etch(SYSTEM_ADDR, address(new MockSystem()).code);
        sys = MockSystem(payable(SYSTEM_ADDR));

        factory = new ForwarderFactory();
        till = new TillReactive{value: 1 ether}();

        _addChain(HOME);
        _addChain(UNI);
        _addChain(SEP);

        book = new InvoiceBook{value: 0.1 ether}(
            IPayable(payable(address(proxyOf[HOME]))), address(till), factory
        );
        chainOf[address(book)] = HOME;

        till.setHome(HOME, address(book));
        till.addPayChain(HOME, address(usdcOf[HOME]), address(collectorOf[HOME]));
        till.addPayChain(UNI, address(usdcOf[UNI]), address(collectorOf[UNI]));
        till.addPayChain(SEP, address(usdcOf[SEP]), address(collectorOf[SEP]));

        vm.recordLogs();
    }

    function _addChain(uint256 chainId_) internal {
        MockProxy proxy = new MockProxy();
        MockUSDC usdc = new MockUSDC();
        Collector collector =
            new Collector{value: 0.1 ether}(IPayable(payable(address(proxy))), address(till), factory);
        proxyOf[chainId_] = proxy;
        usdcOf[chainId_] = usdc;
        collectorOf[chainId_] = collector;
        chainOf[address(usdc)] = chainId_;
    }

    // ───────────────────────────── A tiny network simulator ─────────────────────────────

    function _record(uint256 chainId_, Vm.Log memory entry_, uint256 txHash_, uint256 logIndex_)
        internal
        pure
        returns (IReactive.LogRecord memory r_)
    {
        uint256 n = entry_.topics.length;
        r_.chainId = chainId_;
        r_.contractAddress = entry_.emitter;
        r_.topic0 = n > 0 ? uint256(entry_.topics[0]) : 0;
        r_.topic1 = n > 1 ? uint256(entry_.topics[1]) : 0;
        r_.topic2 = n > 2 ? uint256(entry_.topics[2]) : 0;
        r_.topic3 = n > 3 ? uint256(entry_.topics[3]) : 0;
        r_.data = entry_.data;
        r_.blockNumber = 1;
        r_.opCode = n;
        r_.blockHash = 0;
        r_.txHash = txHash_;
        r_.logIndex = logIndex_;
    }

    /// @dev Plays the network: delivers recorded logs to Till when a subscription matches, turns each
    ///      `CallbackRequest` Till caused into a call through the right chain's proxy, and repeats
    ///      until everything is quiet.
    function _pump() internal {
        for (uint256 round = 0; round < 8; round++) {
            Vm.Log[] memory logs = vm.getRecordedLogs();
            if (logs.length == 0) return;
            uint256 txHash = uint256(keccak256(abi.encode("tx", ++txNonce)));
            for (uint256 i = 0; i < logs.length; i++) {
                if (logs[i].emitter == SYSTEM_ADDR) {
                    if (logs[i].topics[0] == CALLBACK_REQUEST_TOPIC0) _deliverCallback(logs[i]);
                    continue;
                }
                uint256 chainId = chainOf[logs[i].emitter];
                if (chainId == 0) continue;
                IReactive.LogRecord memory rec = _record(chainId, logs[i], txHash, i);
                if (!sys.matches(address(till), rec)) continue;
                vm.prank(SYSTEM_ADDR);
                till.react(rec);
            }
        }
        fail("network never went quiet");
    }

    function _deliverCallback(Vm.Log memory request_) internal {
        (, bytes memory configuration) = abi.decode(request_.data, (ISystemContract.CallbackVersion, bytes));
        ISystemContract.CallbackConfiguration_V_1_0 memory config =
            abi.decode(configuration, (ISystemContract.CallbackConfiguration_V_1_0));
        address sender = address(uint160(uint256(request_.topics[2])));
        (bool ok,) =
            proxyOf[config.chainId].deliver(config.recipient, config.payload, sender, config.gasLimit);
        assertTrue(ok, "a callback reverted");
    }

    function _create(uint256 amount_) internal returns (bytes32 id_, address deposit_) {
        vm.prank(seller);
        (id_, deposit_) =
            book.createInvoice(coldWallet, amount_, block.timestamp + 7 days, "Logo design, March");
        _pump();
    }

    function _pay(uint256 chainId_, address deposit_, uint256 amount_) internal {
        usdcOf[chainId_].mint(payer, amount_);
        vm.prank(payer);
        usdcOf[chainId_].transfer(deposit_, amount_);
        _pump();
    }

    function _watching(address deposit_, uint256 chainId_) internal view returns (bool) {
        return sys.isSubscribed(
            address(till),
            chainId_,
            address(usdcOf[chainId_]),
            TRANSFER_TOPIC0,
            IGNORE,
            uint256(uint160(deposit_)),
            IGNORE
        );
    }

    function _coldTotal() internal view returns (uint256) {
        return usdcOf[HOME].balanceOf(coldWallet) + usdcOf[UNI].balanceOf(coldWallet)
            + usdcOf[SEP].balanceOf(coldWallet);
    }

    // ───────────────────────────── The happy path ─────────────────────────────

    function test_DepositAddressIsKnownBeforeAnyCodeExists() public {
        (bytes32 id, address deposit) = _create(250 * USDC);

        assertEq(deposit, factory.depositAddress(coldWallet, id));
        assertEq(deposit.code.length, 0, "nothing is deployed at the deposit address yet");
        assertEq(book.getInvoice(id).depositAddress, deposit);
    }

    function test_CreateInvoice_StartsWatchingOnEveryPayChain() public {
        assertEq(sys.liveCount(), 2, "idle Till only listens to its InvoiceBook");

        (bytes32 id, address deposit) = _create(250 * USDC);

        assertEq(sys.liveCount(), 5);
        assertTrue(_watching(deposit, HOME));
        assertTrue(_watching(deposit, UNI));
        assertTrue(_watching(deposit, SEP));
        assertEq(till.depositOf(id), deposit);
        (
            bytes32 wid,
            address payTo,
            uint128 amount,,,
            uint8 chains,
            bool active,
            uint64 watchedBlock,
            uint64 seenBlock
        ) = till.watches(deposit);
        assertEq(watchedBlock, block.number);
        assertEq(seenBlock, 0);
        assertEq(book.getInvoice(id).createdBlock, block.number);
        assertEq(wid, id);
        assertEq(payTo, coldWallet);
        assertEq(amount, 250 * USDC);
        assertEq(chains, 3);
        assertTrue(active);
    }

    function test_PayOnAnotherChain_MarksPaidAndSweepsToSeller() public {
        (bytes32 id, address deposit) = _create(250 * USDC);

        vm.warp(block.timestamp + 1 hours);
        vm.roll(block.number + 300);
        _pay(UNI, deposit, 250 * USDC); // a plain transfer on Unichain; the books are on Base

        InvoiceBook.Invoice memory inv = book.getInvoice(id);
        assertEq(uint8(inv.status), uint8(InvoiceBook.Status.Paid));
        assertEq(inv.received, 250 * USDC);
        assertEq(inv.payer, payer);
        assertEq(inv.paidOnChain, UNI);
        assertEq(inv.paidAt, block.timestamp);
        assertEq(inv.paidBlock, block.number);
        assertTrue(inv.payTxHash != bytes32(0), "the paying transaction is on record");
        (,,,,,,,, uint64 seenBlock) = till.watches(deposit);
        assertEq(seenBlock, block.number);

        assertEq(usdcOf[UNI].balanceOf(coldWallet), 250 * USDC, "money is in the cold wallet");
        assertEq(usdcOf[UNI].balanceOf(deposit), 0);
        assertEq(sys.totalCallbacks(), 2, "one event, two callbacks");
        assertEq(sys.liveCount(), 2, "Till stopped watching once paid");
        assertFalse(_watching(deposit, UNI));
    }

    function test_PayOnHomeChain_Works() public {
        (bytes32 id, address deposit) = _create(40 * USDC);
        _pay(HOME, deposit, 40 * USDC);

        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Paid));
        assertEq(usdcOf[HOME].balanceOf(coldWallet), 40 * USDC);
    }

    function test_PartialPaymentsAcrossTwoChains_SettleTogether() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        _pay(UNI, deposit, 60 * USDC);
        InvoiceBook.Invoice memory inv = book.getInvoice(id);
        assertEq(uint8(inv.status), uint8(InvoiceBook.Status.Open));
        assertEq(inv.received, 60 * USDC);
        assertEq(usdcOf[UNI].balanceOf(coldWallet), 60 * USDC, "partial payments are swept straight away");
        assertTrue(_watching(deposit, SEP), "still watching for the rest");

        _pay(SEP, deposit, 40 * USDC);
        inv = book.getInvoice(id);
        assertEq(uint8(inv.status), uint8(InvoiceBook.Status.Paid));
        assertEq(inv.received, 100 * USDC);
        assertEq(inv.paidOnChain, SEP);
        assertEq(_coldTotal(), 100 * USDC);
        assertEq(sys.liveCount(), 2);
    }

    function test_Overpayment_AllGoesToSeller() public {
        (bytes32 id, address deposit) = _create(100 * USDC);
        _pay(UNI, deposit, 130 * USDC);

        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Paid));
        assertEq(book.getInvoice(id).received, 130 * USDC);
        assertEq(usdcOf[UNI].balanceOf(coldWallet), 130 * USDC);
    }

    function test_TwoInvoices_DoNotMixUp() public {
        (bytes32 idA, address depositA) = _create(10 * USDC);
        (bytes32 idB, address depositB) = _create(20 * USDC);
        assertTrue(depositA != depositB);

        _pay(SEP, depositB, 20 * USDC);

        assertEq(uint8(book.getInvoice(idA).status), uint8(InvoiceBook.Status.Open));
        assertEq(uint8(book.getInvoice(idB).status), uint8(InvoiceBook.Status.Paid));
        assertTrue(_watching(depositA, SEP));
        assertFalse(_watching(depositB, SEP));
    }

    // ───────────────────────────── Things that must not count ─────────────────────────────

    function test_SameLogDeliveredTwice_CountsOnce() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        IReactive.LogRecord memory rec =
            _transferRecord(UNI, address(usdcOf[UNI]), payer, deposit, 60 * USDC, 777, 3);
        vm.startPrank(SYSTEM_ADDR);
        till.react(rec);
        till.react(rec);
        vm.stopPrank();

        (,,, uint128 received,,,,,) = till.watches(deposit);
        assertEq(received, 60 * USDC);
        assertEq(sys.totalCallbacks(), 2, "the second delivery requested nothing");
        assertEq(till.depositOf(id), deposit);
    }

    function test_WrongToken_IsIgnored() public {
        (, address deposit) = _create(100 * USDC);
        MockUSDC fake = new MockUSDC();

        // The network would not even deliver this: no subscription names the fake token.
        IReactive.LogRecord memory rec = _transferRecord(UNI, address(fake), payer, deposit, 100 * USDC, 1, 0);
        assertFalse(sys.matches(address(till), rec));

        // And if it were delivered, Till checks the token itself.
        vm.prank(SYSTEM_ADDR);
        till.react(rec);
        (,,, uint128 received,,,,,) = till.watches(deposit);
        assertEq(received, 0);
        assertEq(sys.totalCallbacks(), 0);
    }

    function test_RightTokenWrongChain_IsIgnored() public {
        (, address deposit) = _create(100 * USDC);

        // Unichain's USDC address reported from a chain Till does not accept payment on.
        IReactive.LogRecord memory rec =
            _transferRecord(999, address(usdcOf[UNI]), payer, deposit, 100 * USDC, 1, 0);
        vm.prank(SYSTEM_ADDR);
        till.react(rec);
        // Base's chain id with Unichain's token.
        rec = _transferRecord(HOME, address(usdcOf[UNI]), payer, deposit, 100 * USDC, 2, 0);
        vm.prank(SYSTEM_ADDR);
        till.react(rec);

        assertEq(sys.totalCallbacks(), 0);
    }

    function test_TransferToUnwatchedAddress_IsIgnored() public {
        _create(100 * USDC);
        IReactive.LogRecord memory rec =
            _transferRecord(UNI, address(usdcOf[UNI]), payer, stranger, 100 * USDC, 1, 0);
        vm.prank(SYSTEM_ADDR);
        till.react(rec);
        assertEq(sys.totalCallbacks(), 0);
    }

    function test_MalformedTransferLogs_AreIgnored() public {
        (, address deposit) = _create(100 * USDC);
        IReactive.LogRecord memory rec =
            _transferRecord(UNI, address(usdcOf[UNI]), payer, deposit, 100 * USDC, 1, 0);

        rec.opCode = 4; // an ERC-721 Transfer has four topics
        vm.prank(SYSTEM_ADDR);
        till.react(rec);

        rec.opCode = 3;
        rec.data = abi.encode(uint256(100 * USDC), uint256(1)); // wrong data length
        vm.prank(SYSTEM_ADDR);
        till.react(rec);

        assertEq(sys.totalCallbacks(), 0);
    }

    function test_Dust_IsIgnored_ThenSweptWithTheRealPayment() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        _pay(UNI, deposit, USDC / 2); // 0.5 USDC against a 100 USDC invoice: under 1%
        assertEq(sys.totalCallbacks(), 0, "dust costs Till no callbacks");
        assertEq(book.getInvoice(id).received, 0);

        _pay(UNI, deposit, 100 * USDC);
        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Paid));
        assertEq(usdcOf[UNI].balanceOf(coldWallet), 100 * USDC + USDC / 2, "the dust reached the seller too");
    }

    function test_UnrelatedLogs_NeverRevert() public {
        IReactive.LogRecord memory rec;
        rec.chainId = 424242;
        rec.contractAddress = stranger;
        rec.topic0 = uint256(keccak256("Whatever()"));
        rec.opCode = 1;
        vm.prank(SYSTEM_ADDR);
        till.react(rec); // must not revert: a reverting react() is still billed
    }

    // ───────────────────────────── Cancel, expire, pause ─────────────────────────────

    function test_Cancel_StopsWatching_AndLateMoneyIsNotLost() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        vm.prank(seller);
        book.cancelInvoice(id);
        _pump();

        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Cancelled));
        assertEq(sys.liveCount(), 2);

        _pay(UNI, deposit, 100 * USDC); // the payer pays anyway
        assertEq(sys.totalCallbacks(), 0, "Till is no longer watching");
        assertEq(usdcOf[UNI].balanceOf(deposit), 100 * USDC);

        vm.prank(stranger); // anyone can push it on to the seller
        factory.flush(coldWallet, id, address(usdcOf[UNI]));
        assertEq(usdcOf[UNI].balanceOf(coldWallet), 100 * USDC);
    }

    function test_Cancel_OnlySeller_OnlyOpen() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        vm.prank(stranger);
        vm.expectRevert(InvoiceBook.NotSeller.selector);
        book.cancelInvoice(id);

        _pay(UNI, deposit, 100 * USDC);
        vm.prank(seller);
        vm.expectRevert(InvoiceBook.NotOpen.selector);
        book.cancelInvoice(id);
    }

    function test_PaymentRacingACancel_StillMarksPaid() public {
        (bytes32 id, address deposit) = _create(100 * USDC);

        // The payment and the cancellation land before Reactive has delivered either.
        usdcOf[UNI].mint(payer, 100 * USDC);
        vm.prank(payer);
        usdcOf[UNI].transfer(deposit, 100 * USDC);
        vm.prank(seller);
        book.cancelInvoice(id);
        _pump();

        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Paid));
        assertEq(usdcOf[UNI].balanceOf(coldWallet), 100 * USDC);
        assertEq(sys.liveCount(), 2);
    }

    function test_Prune_OnlyAfterExpiry() public {
        (, address deposit) = _create(100 * USDC);
        address[] memory list = new address[](1);
        list[0] = deposit;

        vm.prank(stranger);
        till.prune(list);
        assertTrue(_watching(deposit, UNI), "not expired yet");

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(stranger);
        till.prune(list);
        assertFalse(_watching(deposit, UNI));
        assertEq(sys.liveCount(), 2);

        till.prune(list); // pruning twice is harmless
        assertEq(sys.liveCount(), 2);
    }

    function test_Paused_IgnoresNewInvoices_ButSettlesOldOnes() public {
        (bytes32 oldId, address oldDeposit) = _create(10 * USDC);

        till.setPaused(true);
        (bytes32 newId, address newDeposit) = _create(10 * USDC);
        assertEq(till.depositOf(newId), address(0));
        assertFalse(_watching(newDeposit, UNI));

        _pay(UNI, oldDeposit, 10 * USDC);
        assertEq(uint8(book.getInvoice(oldId).status), uint8(InvoiceBook.Status.Paid));
    }

    function test_PayChainAddedLater_OnlyAppliesToNewInvoices() public {
        (, address oldDeposit) = _create(10 * USDC);

        uint256 arb = 421614;
        _addChain(arb);
        till.addPayChain(arb, address(usdcOf[arb]), address(collectorOf[arb]));

        (bytes32 newId, address newDeposit) = _create(10 * USDC);
        assertFalse(_watching(oldDeposit, arb));
        assertTrue(_watching(newDeposit, arb));

        _pay(arb, newDeposit, 10 * USDC);
        assertEq(uint8(book.getInvoice(newId).status), uint8(InvoiceBook.Status.Paid));
        assertEq(sys.liveCount(), 2 + 3, "only the old invoice's three subscriptions remain");
    }

    // ───────────────────────────── Who may call what ─────────────────────────────

    function test_React_OnlySystem() public {
        IReactive.LogRecord memory rec;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, SYSTEM_ADDR));
        till.react(rec);
    }

    function test_RecordPayment_OnlyThroughProxy_OnlyFromOurReactive() public {
        (bytes32 id,) = _create(100 * USDC);
        address proxy = address(proxyOf[HOME]);

        vm.prank(stranger); // not the callback proxy
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, proxy));
        book.recordPayment(address(till), id, UNI, payer, 100 * USDC, 1);

        vm.prank(proxy); // the proxy, but on behalf of someone else's reactive contract
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, stranger, address(till))
        );
        book.recordPayment(stranger, id, UNI, payer, 100 * USDC, 1);

        assertEq(uint8(book.getInvoice(id).status), uint8(InvoiceBook.Status.Open));
    }

    function test_RecordPayment_UnknownInvoiceReverts() public {
        vm.prank(address(proxyOf[HOME]));
        vm.expectRevert(InvoiceBook.UnknownInvoice.selector);
        book.recordPayment(address(till), bytes32(uint256(1)), UNI, payer, 1, 1);
    }

    function test_Sweep_OnlyThroughProxy_OnlyFromOurReactive() public {
        (bytes32 id,) = _create(100 * USDC);
        Collector collector = collectorOf[UNI];
        address proxy = address(proxyOf[UNI]);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, proxy));
        collector.sweep(address(till), coldWallet, id, address(usdcOf[UNI]));

        vm.prank(proxy);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, stranger, address(till))
        );
        collector.sweep(stranger, coldWallet, id, address(usdcOf[UNI]));
    }

    function test_OwnerOnlySetup() public {
        vm.startPrank(stranger);
        vm.expectRevert(TillReactive.NotOwner.selector);
        till.setHome(1, stranger);
        vm.expectRevert(TillReactive.NotOwner.selector);
        till.addPayChain(1, stranger, stranger);
        vm.expectRevert(TillReactive.NotOwner.selector);
        till.setPaused(true);
        vm.expectRevert(TillReactive.NotOwner.selector);
        till.withdraw(1);
        vm.expectRevert(InvoiceBook.NotOwner.selector);
        book.withdraw(1);
        vm.expectRevert(Collector.NotOwner.selector);
        collectorOf[UNI].withdraw(1);
        vm.stopPrank();
    }

    function test_SetupGuards() public {
        vm.expectRevert(TillReactive.HomeAlreadySet.selector);
        till.setHome(HOME, address(book));

        vm.expectRevert(TillReactive.ChainAlreadyAdded.selector);
        till.addPayChain(UNI, address(usdcOf[UNI]), address(collectorOf[UNI]));

        vm.expectRevert(TillReactive.ZeroAddress.selector);
        till.addPayChain(5, address(0), stranger);

        for (uint256 i = 0; i < 3; i++) {
            till.addPayChain(1000 + i, stranger, stranger);
        }
        vm.expectRevert(TillReactive.TooManyChains.selector);
        till.addPayChain(2000, stranger, stranger);
        assertEq(till.payChains().length, till.MAX_PAY_CHAINS());
    }

    function test_OwnerCanWithdrawGasMoney() public {
        // The test contract is the owner; give it a way to receive.
        uint256 before = address(this).balance;
        till.withdraw(0.25 ether);
        book.withdraw(0.01 ether);
        collectorOf[UNI].withdraw(0.01 ether);
        assertEq(address(this).balance, before + 0.27 ether);
    }

    receive() external payable {}

    // ───────────────────────────── Invoice rules ─────────────────────────────

    function test_CreateInvoice_Validation() public {
        vm.startPrank(seller);
        vm.expectRevert(InvoiceBook.BadPayTo.selector);
        book.createInvoice(address(0), 1, block.timestamp + 1 days, "");

        vm.expectRevert(InvoiceBook.BadAmount.selector);
        book.createInvoice(coldWallet, 0, block.timestamp + 1 days, "");

        vm.expectRevert(InvoiceBook.BadAmount.selector);
        book.createInvoice(coldWallet, uint256(type(uint128).max) + 1, block.timestamp + 1 days, "");

        vm.expectRevert(InvoiceBook.BadExpiry.selector);
        book.createInvoice(coldWallet, 1, block.timestamp, "");

        vm.expectRevert(InvoiceBook.BadExpiry.selector);
        book.createInvoice(coldWallet, 1, block.timestamp + 91 days, "");

        bytes memory long = new bytes(141);
        vm.expectRevert(InvoiceBook.MemoTooLong.selector);
        book.createInvoice(coldWallet, 1, block.timestamp + 1 days, string(long));
        vm.stopPrank();
    }

    function test_InvoicesOf_Pages() public {
        bytes32[] memory ids = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) {
            (ids[i],) = _create((i + 1) * USDC);
        }
        assertEq(book.invoiceCountOf(seller), 5);

        bytes32[] memory page = book.invoicesOf(seller, 1, 3);
        assertEq(page.length, 3);
        assertEq(page[0], ids[1]);
        assertEq(page[2], ids[3]);
        assertEq(book.invoicesOf(seller, 4, 10).length, 1);
        assertEq(book.invoicesOf(seller, 5, 10).length, 0);
    }

    // ───────────────────────────── The deposit address ─────────────────────────────

    function test_Forwarder_AnyoneCanFlush_ButOnlyToPayTo() public {
        (bytes32 id, address deposit) = _create(100 * USDC);
        till.setPaused(true); // irrelevant to flushing; shows it needs no Reactive at all

        usdcOf[SEP].mint(deposit, 7 * USDC);
        vm.prank(stranger);
        uint256 sent = factory.flush(coldWallet, id, address(usdcOf[SEP]));

        assertEq(sent, 7 * USDC);
        assertEq(usdcOf[SEP].balanceOf(coldWallet), 7 * USDC);
        assertEq(Forwarder(deposit).PAY_TO(), coldWallet);

        // A different payTo is a different address: a stranger cannot aim this deposit elsewhere.
        assertTrue(factory.depositAddress(stranger, id) != deposit);
        vm.prank(stranger);
        assertEq(factory.flush(stranger, id, address(usdcOf[SEP])), 0);
    }

    function test_Forwarder_HandlesTokensThatReturnNothing() public {
        (bytes32 id, address deposit) = _create(100 * USDC);
        NoReturnToken usdt = new NoReturnToken();
        usdt.mint(deposit, 5 * USDC);

        factory.flush(coldWallet, id, address(usdt));
        assertEq(usdt.balanceOf(coldWallet), 5 * USDC);
    }

    function test_Forwarder_RevertsWhenTokenReturnsFalse() public {
        (bytes32 id, address deposit) = _create(100 * USDC);
        FalseReturnToken bad = new FalseReturnToken();
        bad.mint(deposit, 5 * USDC);

        vm.expectRevert(Forwarder.TransferFailed.selector);
        factory.flush(coldWallet, id, address(bad));
    }

    // ───────────────────────────── Gas: must fit Reactive's limits ─────────────────────────────

    /// @dev Reactive caps a reactive transaction at 900,000 gas. With the most pay chains allowed,
    ///      both react() paths must leave plenty of room for the real system contract's own costs.
    function test_Gas_ReactFitsTheCap_WithMaxPayChains() public {
        for (uint256 i = 0; i < 3; i++) {
            _addChain(5000 + i);
            till.addPayChain(5000 + i, address(usdcOf[5000 + i]), address(collectorOf[5000 + i]));
        }
        assertEq(till.payChains().length, till.MAX_PAY_CHAINS());

        vm.prank(seller);
        (, address deposit) =
            book.createInvoice(coldWallet, 100 * USDC, block.timestamp + 1 days, "max chains");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        IReactive.LogRecord memory created = _record(HOME, logs[logs.length - 1], 1, 0);

        vm.prank(SYSTEM_ADDR);
        uint256 g = gasleft();
        till.react(created);
        uint256 createGas = g - gasleft();

        IReactive.LogRecord memory paid =
            _transferRecord(UNI, address(usdcOf[UNI]), payer, deposit, 100 * USDC, 9, 0);
        vm.prank(SYSTEM_ADDR);
        g = gasleft();
        till.react(paid);
        uint256 payGas = g - gasleft();

        emit log_named_uint("react(InvoiceCreated) gas, 6 pay chains", createGas);
        emit log_named_uint("react(Transfer) gas, 6 pay chains", payGas);
        assertLt(createGas, 400_000);
        assertLt(payGas, 400_000);
    }

    /// @dev The callback proxy keeps part of the gas limit for itself, so leave a wide margin.
    function test_Gas_CallbacksFitTheirLimits() public {
        (bytes32 id, address deposit) = _create(100 * USDC);
        usdcOf[UNI].mint(deposit, 100 * USDC);

        // Measure as a fresh transaction would pay: nothing warm from the setup above.
        vm.cool(address(book));
        vm.cool(address(collectorOf[UNI]));
        vm.cool(address(factory));
        vm.cool(address(usdcOf[UNI]));

        vm.prank(address(proxyOf[HOME]));
        uint256 g = gasleft();
        book.recordPayment(address(till), id, UNI, payer, 100 * USDC, 1);
        uint256 recordGas = g - gasleft();

        vm.prank(address(proxyOf[UNI]));
        g = gasleft();
        collectorOf[UNI].sweep(address(till), coldWallet, id, address(usdcOf[UNI]));
        uint256 sweepGas = g - gasleft();

        emit log_named_uint("recordPayment gas", recordGas);
        emit log_named_uint("sweep gas (first, deploys the forwarder)", sweepGas);
        assertLt(recordGas, till.RECORD_GAS_LIMIT() - 200_000);
        assertLt(sweepGas, till.SWEEP_GAS_LIMIT() - 200_000);
    }

    // ───────────────────────────── Fuzz: the books always add up ─────────────────────────────

    function testFuzz_PaymentsAddUp(uint256 due_, uint256 a_, uint256 b_, uint256 c_) public {
        due_ = bound(due_, 1 * USDC, 1_000_000 * USDC);
        uint256 dust = due_ / 100;
        a_ = bound(a_, dust, due_);
        b_ = bound(b_, dust, due_);
        c_ = bound(c_, dust, due_);

        (bytes32 id, address deposit) = _create(due_);

        uint256[3] memory parts = [a_, b_, c_];
        uint256[3] memory chains = [UNI, SEP, HOME];
        uint256 counted;
        uint256 sent;
        for (uint256 i = 0; i < 3; i++) {
            bool wasSettled = counted >= due_;
            _pay(chains[i], deposit, parts[i]);
            sent += parts[i];
            if (!wasSettled) counted += parts[i]; // once settled, Till has stopped watching
        }

        InvoiceBook.Invoice memory inv = book.getInvoice(id);
        assertEq(inv.received, counted, "books match what Till saw");
        assertEq(
            uint8(inv.status), uint8(counted >= due_ ? InvoiceBook.Status.Paid : InvoiceBook.Status.Open)
        );
        assertEq(_coldTotal(), counted, "everything counted has been swept to the seller");

        // Whatever arrived after settlement is still only ever the seller's.
        factory.flush(coldWallet, id, address(usdcOf[UNI]));
        factory.flush(coldWallet, id, address(usdcOf[SEP]));
        factory.flush(coldWallet, id, address(usdcOf[HOME]));
        assertEq(_coldTotal(), sent, "no money is ever stuck or misdirected");
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _transferRecord(
        uint256 chainId_,
        address token_,
        address from_,
        address to_,
        uint256 amount_,
        uint256 txHash_,
        uint256 logIndex_
    ) internal pure returns (IReactive.LogRecord memory r_) {
        r_.chainId = chainId_;
        r_.contractAddress = token_;
        r_.topic0 = TRANSFER_TOPIC0;
        r_.topic1 = uint256(uint160(from_));
        r_.topic2 = uint256(uint160(to_));
        r_.data = abi.encode(amount_);
        r_.blockNumber = 1;
        r_.opCode = 3;
        r_.txHash = txHash_;
        r_.logIndex = logIndex_;
    }
}
