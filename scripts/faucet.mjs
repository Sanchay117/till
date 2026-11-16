// Swaps testnet ETH for lREACT through Reactive's faucet contract (1 ETH = 100 lREACT, 5 ETH max).
// https://dev.reactive.network/reactive-mainnet#get-testnet-react
//   npm run faucet                 0.05 Base Sepolia ETH -> 5 lREACT
//   npm run faucet -- 0.1 sepolia  0.1 Ethereum Sepolia ETH -> 10 lREACT
import { formatEther, parseEther } from 'viem'
import { REACTIVE, account, network, publicClient, txUrl, waitFor, walletClient } from './lib.mjs'

const FAUCETS = {
  baseSepolia: '0x2afaFD298b23b62760711756088F75B7409f5967',
  sepolia: '0x9b9BB25f1A81078C544C829c5EB7822d747Cf434',
}
const FAUCET_ABI = [
  { type: 'function', name: 'request', stateMutability: 'payable', inputs: [{ type: 'address' }], outputs: [] },
]

const [amountArg = '0.05', from = 'baseSepolia'] = process.argv.slice(2)
const amount = parseEther(amountArg)
if (!FAUCETS[from]) throw new Error(`The faucet lives on: ${Object.keys(FAUCETS).join(', ')}`)
if (amount > parseEther('5')) throw new Error('The faucet takes 5 ETH at most; anything above that is lost.')

const me = account().address
const reactive = publicClient(REACTIVE)
const before = await reactive.getBalance({ address: me })

console.log(`Sending ${amountArg} ETH on ${network(from).name} to the Reactive faucet for ${me}...`)
const hash = await walletClient(from).writeContract({
  address: FAUCETS[from], abi: FAUCET_ABI, functionName: 'request', args: [me], value: amount,
})
const receipt = await publicClient(from).waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') throw new Error(`Faucet request failed: ${txUrl(from, hash)}`)
console.log(`  sent: ${txUrl(from, hash)}`)

console.log('Waiting for lREACT to arrive on Lasna (can take a minute)...')
const after = await waitFor(
  async () => {
    const b = await reactive.getBalance({ address: me })
    return b > before ? b : null
  },
  { timeoutMs: 300_000, everyMs: 3000, what: 'lREACT to arrive' },
)
console.log(`Balance on Lasna: ${formatEther(after)} lREACT (+${formatEther(after - before)})`)
