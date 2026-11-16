// Moves Ethereum Sepolia test ETH to an L2 testnet through that chain's canonical bridge, so one
// Sepolia faucet can fund every chain Till runs on. The ETH arrives at the same address on the L2.
//   npm run bridge -- unichainSepolia 0.003
//   npm run bridge -- baseSepolia 0.003
import { formatEther, parseEther } from 'viem'
import { account, network, publicClient, txUrl, waitFor, walletClient } from './lib.mjs'

// Bridge contracts on Ethereum Sepolia. Sending them plain ETH deposits it to the sender on the L2.
const BRIDGES = {
  // https://developers.uniswap.org/docs/unichain/getting-started/get-funds-on-unichain
  unichainSepolia: '0xea58fcA6849d79EAd1f26608855c2D6407d54Ce2',
  // L1StandardBridge, https://docs.base.org/specifications/reference/base-contracts
  baseSepolia: '0xfd0Bf71F60660E2f608ed56e1659C450eB113120',
}

const [to, amountArg = '0.003'] = process.argv.slice(2)
if (!BRIDGES[to]) throw new Error(`Usage: npm run bridge -- <${Object.keys(BRIDGES).join('|')}> [eth]`)
const amount = parseEther(amountArg)
const me = account().address
const l2 = publicClient(to)
const before = await l2.getBalance({ address: me })

console.log(`Bridging ${amountArg} Sepolia ETH to ${network(to).name} for ${me}...`)
const hash = await walletClient('sepolia').sendTransaction({ to: BRIDGES[to], value: amount })
const receipt = await publicClient('sepolia').waitForTransactionReceipt({ hash, timeout: 180_000 })
if (receipt.status !== 'success') throw new Error(`Bridge deposit failed: ${txUrl('sepolia', hash)}`)
console.log(`  deposited: ${txUrl('sepolia', hash)}`)

console.log(`Waiting for it to arrive on ${network(to).name} (usually a few minutes)...`)
const after = await waitFor(
  async () => {
    const b = await l2.getBalance({ address: me })
    return b > before ? b : null
  },
  { timeoutMs: 900_000, everyMs: 5000, what: `ETH to arrive on ${network(to).name}` },
)
console.log(`Balance on ${network(to).name}: ${formatEther(after)} ETH (+${formatEther(after - before)})`)
