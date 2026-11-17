# Till

**An invoice that marks itself paid, whichever chain the money lands on.**

**[Try it live: till-theta.vercel.app](https://till-theta.vercel.app)** · **[Watch the demo](https://youtu.be/ZL7I8KaX7Jg)** (2:40)

No wallet, no sign-up. Press *Watch one get paid* and a demo wallet pays a real invoice with test USDC
while you watch every transaction land.

[![Watch the demo: Till, an invoice that marks itself paid](https://img.youtube.com/vi/ZL7I8KaX7Jg/hqdefault.jpg)](https://youtu.be/ZL7I8KaX7Jg)

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon/detail), track *Set It and Forget It*.

> Status, 17 Nov 2026: live on Reactive Lasna, Base Sepolia, Unichain Sepolia and Ethereum Sepolia.
> 16 of 17 test invoices have been paid, and all 16 settled: 15 paid on Unichain and 1 on Base itself.
> Each was marked PAID on Base 1 or 2 seconds after the payment landed, by block timestamps, which are
> whole seconds. The 17th expired unpaid. Sixteen runs is a first sample, not a benchmark.

## Live on testnet

| Contract | Chain | Address |
|---|---|---|
| TillReactive | Reactive Lasna | [`0xc0605f77903922a466e1292f1fa7a0240f46e7dc`](https://lasna.reactscan.net/address/0xc0605f77903922a466e1292f1fa7a0240f46e7dc) |
| InvoiceBook | Base Sepolia | [`0xfa222c8fc2af8ca27a23816f071449d08141a5a1`](https://base-sepolia.blockscout.com/address/0xfa222c8fc2af8ca27a23816f071449d08141a5a1) |
| Collector | Base Sepolia | [`0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa`](https://base-sepolia.blockscout.com/address/0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa) |
| Collector | Unichain Sepolia | [`0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa`](https://sepolia.uniscan.xyz/address/0xc88a34d40a9b87700e3e81dc2c87fbdc3a97b6aa) |
| Collector | Ethereum Sepolia | [`0x8e08a7577e67de4dd3230c5932fbe19281d43b9d`](https://sepolia.etherscan.io/address/0x8e08a7577e67de4dd3230c5932fbe19281d43b9d) |
| ForwarderFactory | all three pay chains | `0x8C6835c46ceb6FC07624bC920af255091765dcB5` |

One full loop, from origin event to both callbacks: the run filmed in the demo video (invoice `0xda4502…076f`, 0.10 test USDC):

| Step | Chain | Transaction |
|---|---|---|
| 1. Invoice created | Base Sepolia | [`0xafbe0308…`](https://base-sepolia.blockscout.com/tx/0xafbe03083d11f4a50516de0d71b984489f2e9bd0425867b802adaae3f046a507) |
| 2. Reactive starts watching the deposit address | Lasna | [`0x641fcd52…`](https://lasna.reactscan.net/tx/0x641fcd527e3a1229076e3ecaa664acee0856693b0aa269a68d79d392dccca3e1) |
| 3. Payer sends USDC, a plain transfer | Unichain Sepolia | [`0x9b203684…`](https://sepolia.uniscan.xyz/tx/0x9b203684c5ee2b23529459c7b60350f38ceb85a8015239ecba7e88b79435b4cc) |
| 4. Reactive transaction | Lasna | [`0x916e942f…`](https://lasna.reactscan.net/tx/0x916e942f143c4c933e0f49462a438f3933548cdc3a966db71e64bdc8e49f4bc4) |
| 5. Callback: invoice marked PAID (+1 s) | Base Sepolia | [`0x486b9581…`](https://base-sepolia.blockscout.com/tx/0x486b9581e69f0d9d7d1dd53be3cda48f155497d89ded1a9d6f1722a27368182e) |
| 6. Callback: money swept to the seller (+2 s) | Unichain Sepolia | [`0x164a1583…`](https://sepolia.uniscan.xyz/tx/0x164a1583c6e05c22ddb21cecd00808a451b91f7d2d90b7b3a59f6fc4df6735e6) |

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

Till never takes custody of your money. A payment waits at the deposit address for about two seconds,
and that address can only ever pay the address you chose. Anyone can trigger the payout.

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

## Why it looks like a patent from 1879

A till is a cash drawer. The cash register was patented on 4 November 1879 by James and John Ritty of
Dayton, Ohio, as U.S. Patent 221,360, "Cash Register and Indicator". James Ritty kept a saloon and built
the machine so he no longer had to trust whoever stood at the drawer; he sold it as the *Incorruptible
Cashier*. Till takes the same watcher out of an invoice, so the app is drawn from that patent sheet: a
register of numbered wheels and a dial of cents. On every invoice page they show what the invoice has
actually received, and the PAID plate drops in when it settles. The register and dial are redrawn in SVG
after the patent, which is in the public domain.

The home page also shows the original: sheet 2 of the patent, as served by Google Patents. The untouched
scan is [`app/artefact/US221360-drawings-page-2.png`](app/artefact/US221360-drawings-page-2.png), and
[`app/scripts/artefact.mjs`](app/scripts/artefact.mjs) trims the scanner's marks and writes the image the
site uses.

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
git clone --recurse-submodules https://github.com/Sanchay117/till.git && cd till
```

```bash
npm install
```

```bash
npm test
```

### Run the web app

```bash
npm install --prefix app
```

```bash
npm run app
```

Open <http://localhost:5173>. The app reads the live testnet contracts, so invoice pages work straight
away. **Watch one get paid** needs a demo wallet: `npm run demo:wallet` creates a second testnet-only key
in `.env` and gives it a little test USDC from the deployer. That key stays on the server side
([`app/server/demo.ts`](app/server/demo.ts)); it only pays invoices it created itself, for 0.10 test USDC.
Those invoices pay out to a different wallet, the demo seller (by default the deployer), so the sweep
visibly moves the money; `npm run demo:wallet` tops the demo wallet up again from the deployer.

### Host the web app

The site is static files plus one small function for the demo wallet.

- **Vercel:** import the repo, set the root directory to `app`, and add `DEMO_PRIVATE_KEY` as an
  environment variable. [`app/vercel.json`](app/vercel.json) does the rest. The function is
  [`app/api/demo/[action].js`](app/api/demo), a single self-contained file bundled from
  [`app/server/handler.ts`](app/server/handler.ts) by `npm run build:api` and committed, so the host has
  nothing to compile or resolve.
- **Anything that runs Node:** `npm run build && npm start` in `app/` serves the same built files and the
  same function from one process ([`app/scripts/serve.mjs`](app/scripts/serve.mjs)).

Only the demo wallet's key goes on the host. The deployer key owns the contracts and stays on your machine.

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
