// Only the parts of each contract the app uses. Keep in step with /src/*.sol.
import { parseAbi } from 'viem'

export const bookAbi = parseAbi([
  'struct Invoice { address seller; uint40 createdAt; uint40 expiresAt; address payTo; uint40 paidAt; uint8 status; address depositAddress; uint64 createdBlock; uint128 amount; uint128 received; address payer; uint64 paidOnChain; uint64 paidBlock; bytes32 payTxHash; string memo; }',
  'function getInvoice(bytes32 id) view returns (Invoice)',
  'function createInvoice(address payTo, uint256 amount, uint256 expiresAt, string memo) returns (bytes32 id, address depositAddress)',
  'function cancelInvoice(bytes32 id)',
  'function invoiceCountOf(address seller) view returns (uint256)',
  'function invoicesOf(address seller, uint256 offset, uint256 limit) view returns (bytes32[])',
  'event InvoiceCreated(bytes32 indexed id, address indexed seller, address indexed depositAddress, address payTo, uint256 amount, uint256 expiresAt, string memo)',
  'event InvoicePaid(bytes32 indexed id, uint256 indexed chainId, address indexed payer, uint256 totalReceived, bytes32 originTxHash)',
])

export const tillAbi = parseAbi([
  'function watches(address depositAddress) view returns (bytes32 invoiceId, address payTo, uint128 amount, uint128 received, uint40 expiresAt, uint8 chains, bool active, uint64 watchedBlock, uint64 seenBlock)',
  'event Watching(bytes32 indexed invoiceId, address indexed depositAddress, uint256 amount, uint256 expiresAt)',
  'event PaymentSeen(bytes32 indexed invoiceId, uint256 indexed chainId, address indexed payer, uint256 amount, uint256 totalReceived, bool settled, uint256 originTxHash)',
])

export const collectorAbi = parseAbi([
  'event Swept(bytes32 indexed invoiceId, address indexed token, address indexed payTo, uint256 amount)',
])

export const factoryAbi = parseAbi(['function flush(address payTo, bytes32 invoiceId, address token) returns (uint256 amount)'])

export const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

/** Matches `InvoiceBook.Status`. */
export const STATUS = { None: 0, Open: 1, Paid: 2, Cancelled: 3 } as const
