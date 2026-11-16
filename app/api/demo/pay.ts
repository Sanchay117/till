import { isHex } from 'viem'
import { DemoError, payDemoInvoice, respond } from '../../server/demo'
import { NETWORKS, type NetworkKey } from '../../src/config'

/** POST /api/demo/pay { id, network }: pay a demo invoice from the demo wallet on the chosen chain. */
export function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const body = (await request.json().catch(() => null)) as { id?: unknown; network?: unknown } | null
    const id = body?.id
    const network = body?.network
    if (typeof id !== 'string' || !isHex(id) || id.length !== 66) throw new DemoError(400, 'Bad invoice id.')
    if (typeof network !== 'string' || !(network in NETWORKS)) throw new DemoError(400, 'Unknown chain.')
    return payDemoInvoice(id, network as NetworkKey)
  })
}
