# Till

**An invoice that marks itself paid, whichever chain the money lands on.**

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon/detail), track *Set It and Forget It*.

> Status, 16 Nov 2026: contracts written and tested locally (35 tests). **Not deployed yet**, so there are
> no live addresses, transaction hashes or measured timings here. They will replace this note.

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

This creates a fresh, testnet-only key in `.env` and prints its address. Fund that address with a little
Base Sepolia and Unichain Sepolia ETH, and test USDC from <https://faucet.circle.com>. Then:

```bash
npm run faucet
```

```bash
npm run deploy
```

```bash
npm run e2e
```

`faucet` swaps 0.05 Base Sepolia ETH for 5 lREACT. `deploy` is safe to re-run and writes addresses to
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
