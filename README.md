# Till

**An invoice that marks itself paid, whichever chain the money lands on.**

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon/detail), track *Set It and Forget It*.

> Status, 16 Nov 2026: live on Reactive Lasna, Base Sepolia, Unichain Sepolia and Ethereum Sepolia.
> Five of five test invoices settled. Paid on Unichain, marked PAID on Base 1 to 2 seconds later by
> block time (2.3 to 2.7 s as seen from a laptop). Five runs is a first sample, not a benchmark.
> There is no web app yet; the loop runs from `npm run e2e`.

## Live on testnet

| Contract | Chain | Address |
|---|---|---|
| TillReactive | Reactive Lasna | [`0xc0605f77903922a466e1292f1fa7a0240f46e7dc`](https://lasna.reactscan.net/address/0xc0605f77903922a466e1292f1fa7a0240f46e7dc) |
| InvoiceBook | Base Sepolia | [`0xfa222c8fc2af8ca27a23816f071449d08141a5a1`](https://sepolia.basescan.org/address/0xfa222c8fc2af8ca27a23816f071449d08141a5a1) |
| Collector | Base Sepolia | [`0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa`](https://sepolia.basescan.org/address/0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa) |
| Collector | Unichain Sepolia | [`0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa`](https://sepolia.uniscan.xyz/address/0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa) |
| Collector | Ethereum Sepolia | [`0x8e08a7577e67de4dd3230c5932fbe19281d43b9d`](https://sepolia.etherscan.io/address/0x8e08a7577e67de4dd3230c5932fbe19281d43b9d) |
| ForwarderFactory | all three pay chains | `0x8C6835c46ceb6FC07624bC920af255091765dcB5` |

One full loop, from origin event to both callbacks (invoice `0x9a26acce…030b75`, 0.10 test USDC):

| Step | Chain | Transaction |
|---|---|---|
| 1. Invoice created | Base Sepolia | [`0xa6740809…`](https://sepolia.basescan.org/tx/0xa6740809d752890f699558bed32eaab445652eb034d5bb723d696071bc295c16) |
| 2. Reactive starts watching the deposit address | Lasna | [`0x6f8af292…`](https://lasna.reactscan.net/tx/0x6f8af292e15d50aabb05dd674735f6c296e7dcd5b90f670a545181d227c73b0b) |
| 3. Payer sends USDC, a plain transfer | Unichain Sepolia | [`0xedbee6c1…`](https://sepolia.uniscan.xyz/tx/0xedbee6c1954170c77e7a66cb0782b83a1ab70d42ecd0c004e58ad1984d040e72) |
| 4. Reactive transaction | Lasna | [`0x8602880b…`](https://lasna.reactscan.net/tx/0x8602880b03e68ff0cfce68a982af5b38a7be2cde39e54561997833f45c183767) |
| 5. Callback: invoice marked PAID | Base Sepolia | [`0xed2d0f8e…`](https://sepolia.basescan.org/tx/0xed2d0f8eb3b05d312874d7668d2f3492941fdef13d2b8ee9c55fb9a61ab7f6ae) |
| 6. Callback: money swept to the seller | Unichain Sepolia | [`0x98b4cbbd…`](https://sepolia.uniscan.xyz/tx/0x98b4cbbda281afbf13b4b311b6ae79afb389605137896c35e328f53ebc26cecd) |

## The problem

I bill clients in USDC. Each one pays from whatever chain they happen to use. To know an invoice is paid I
either hand 1 to 1.5% to a payment processor, run a server with a key online that watches every chain, or
open five block explorers and look.

## What Till does

1. **Create an invoice** on Base. You get one deposit address. It is the same address on every supported
   chain, and nothing is deployed there yet.
2. **The client pays** with an ordinary USDC transfer, from any wallet or exchange, on any supported chain.
   They never touch a Till contract.
3. **The invoice marks itself paid** on Base, and the money moves to your wallet on the chain it arrived
   on. Nobody presses anything.

Till never holds your money. A deposit address can only ever pay the address you chose, and anyone can
trigger that payment.

## Why it needs Reactive

The chain the money lands on and the chain the books live on cannot see each other. Without Reactive that
gap is filled by a bridge or by a server holding a key. Here it is filled by one contract.

`TillReactive` on Reactive Network is the whole back end:

- It hears `InvoiceCreated` on Base and **subscribes at runtime**, from inside `react()`, to USDC
  `Transfer` logs into that invoice's deposit address on every pay chain. It is watching an address that
  has no code.
- When a transfer lands, it adds up what has arrived and requests **two callbacks from the one event**:
  one to Base so the invoice is marked paid, one to the chain the money is on so it is swept to you.
- Once the invoice is settled, cancelled or expired it **unsubscribes**, so an idle Till costs nothing.

```
 Unichain Sepolia                  Reactive (Lasna)                     Base Sepolia
 ────────────────                  ────────────────                     ────────────
                                                                        createInvoice()
                                   react(InvoiceCreated)  ◄──────────── InvoiceCreated
                                     subscribe: USDC Transfer
                                     to the deposit address,
                                     on every pay chain
 USDC.transfer(deposit) ─────────► react(Transfer)
                                     add it up
 Collector.sweep()  ◄───────────────  callback 2      callback 1 ─────► InvoiceBook.recordPayment()
   deposit ─► your wallet                                                 invoice is PAID
                                     unsubscribe
```

## Contracts

| Contract | Chain | Job |
|---|---|---|
| [`TillReactive`](src/TillReactive.sol) | Reactive | Watches deposit addresses, adds up payments, requests the callbacks. |
| [`InvoiceBook`](src/InvoiceBook.sol) | Home chain (Base Sepolia) | The books. Create and cancel invoices; receives "this was paid". |
| [`Collector`](src/Collector.sol) | Every pay chain | Receives "sweep this deposit to the seller". |
| [`ForwarderFactory`](src/ForwarderFactory.sol) | Every pay chain, same address | Derives deposit addresses and deploys the tiny forwarder behind each. |

Details worth knowing:

- **Partial payments** across different chains add up to one invoice.
- **Late or duplicate payments are never stuck.** `ForwarderFactory.flush()` is open to anyone and can
  only send to the seller.
- **Callbacks are authenticated twice**: the caller must be Reactive's callback proxy, and the request
  must come from this `TillReactive`.
- **Dust is ignored** (under 1% of the invoice), so nobody can make Till pay for callbacks with spam. It
  still reaches the seller on the next sweep.
- **Each log counts once**, keyed by chain, transaction and log index.

## Run it

Needs Node 20.6 or newer and git. Foundry comes in through npm, so there is nothing else to install.

```bash
git clone --recurse-submodules <this repo> && cd <this repo>
```

```bash
npm install
```

```bash
npm test
```

### Run the whole loop locally, with no testnet coins

```bash
npm run local
```

Leave that running. It starts three local chains with the real chain ids (Base Sepolia, Unichain Sepolia,
Reactive Lasna), deploys Till with the same script used for the testnets, and runs a small relayer that
plays Reactive Network. Then, in a second terminal:

```bash
npm run e2e:local
```

That creates an invoice on the local Base, pays it on the local Unichain, and prints each step until the
invoice is PAID and the money is swept. What is faked is listed at the top of
[`scripts/local.mjs`](scripts/local.mjs): the system contract, the callback proxies and USDC are mocks placed
at the real addresses. The Till contracts are the real ones.

### Deploy to the testnets

```bash
npm run wallet
```

This creates a fresh, testnet-only key in `.env` and prints its address. One faucet can fund everything:
mine 0.05 Sepolia ETH to that address at <https://sepolia-faucet.pk910.de/>, and get test USDC from
<https://faucet.circle.com>. Then turn the Sepolia ETH into lREACT and into gas on the other chains:

```bash
npm run faucet -- 0.042 sepolia
```

```bash
npm run bridge -- unichainSepolia 0.002
```

```bash
npm run bridge -- baseSepolia 0.002
```

```bash
npm run deploy
```

```bash
npm run e2e
```

`faucet` swaps test ETH for lREACT at 1 ETH = 100 lREACT. `bridge` uses each chain's canonical bridge.
`deploy` is safe to re-run and writes addresses to
`deployments/testnet.json`. `e2e` creates an invoice, pays it on Unichain Sepolia, waits for PAID, and
prints every transaction in the loop with its timing.

## Known limits

- Anyone can create an invoice, and each one costs Till's operator a little REACT. Fine on a testnet;
  mainnet needs a creation fee or an allowlist.
- One token per chain (USDC). The amount is compared in token units, so only add tokens with the same
  decimals and the same value.
- An invoice only watches the pay chains that existed when it was created.

## License

MIT
