// Copies a deployment into the app so it builds on its own (the host has no Foundry output).
//   node scripts/sync.mjs            testnet (the default, and what is committed)
//   node scripts/sync.mjs local      the local devnet from `npm run local`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const name = process.argv[2] || 'testnet'
const source = join(here, '..', '..', 'deployments', `${name}.json`)
if (!existsSync(source)) {
  throw new Error(`No deployments/${name}.json. Run \`npm run ${name === 'local' ? 'local' : 'deploy'}\` in the repo root first.`)
}

const out = {
  name,
  // The local devnet runs each chain on its own port. On the testnets the app uses public RPCs.
  rpc: name === 'local'
    ? { lasna: 'http://127.0.0.1:8547', baseSepolia: 'http://127.0.0.1:8545', unichainSepolia: 'http://127.0.0.1:8546' }
    : {},
  deployment: JSON.parse(readFileSync(source, 'utf8')),
}

const target = join(here, '..', 'src', 'generated', 'deployment.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
console.log(`app/src/generated/deployment.json <- deployments/${name}.json`)
