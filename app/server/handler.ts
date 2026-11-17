// The demo wallet's HTTP interface: one plain Node handler for three actions.
//
//   GET  /api/demo/info      is there a demo wallet, and what is its address?
//   POST /api/demo/invoice   get a demo invoice to watch, creating one if none is open
//   POST /api/demo/pay       { id, network }: pay a demo invoice from the demo wallet
//
// It uses nothing but Node's own request and response, so the same function runs in three places:
// the Vite dev server (vite.config.ts), a plain Node server (scripts/serve.mjs), and a serverless
// host, where the bundled copy in api/demo/[action].js is deployed.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isHex } from 'viem'
import { NETWORKS, type NetworkKey } from '../src/config'
import { DemoError, createDemoInvoice, demoInfo, payDemoInvoice } from './demo'

/** Some hosts parse the query string and body before calling the handler. Use them if present. */
type Request = IncomingMessage & { body?: unknown; query?: Record<string, string | string[] | undefined> }

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req: Request): Promise<unknown> {
  try {
    if (req.body !== undefined) {
      if (typeof req.body === 'string') return JSON.parse(req.body || 'null')
      if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || 'null')
      return req.body
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 10_000) throw new DemoError(413, 'Request too large.')
      chunks.push(chunk as Buffer)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : null
  } catch (error) {
    if (error instanceof DemoError) throw error
    throw new DemoError(400, 'The request body is not valid JSON.')
  }
}

function actionOf(req: Request): string | undefined {
  const fromQuery = req.query?.action
  if (fromQuery) return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean).pop()
}

export default async function handler(req: Request, res: ServerResponse): Promise<void> {
  const action = actionOf(req)
  const expects = { info: 'GET', invoice: 'POST', pay: 'POST' }[action ?? '']
  try {
    if (!expects) throw new DemoError(404, 'No such demo action.')
    if (req.method !== expects) throw new DemoError(405, `Use ${expects} for this action.`)

    if (action === 'info') return send(res, 200, await demoInfo())
    if (action === 'invoice') return send(res, 200, await createDemoInvoice())

    const body = (await readJson(req)) as { id?: unknown; network?: unknown } | null
    const id = body?.id
    const network = body?.network
    if (typeof id !== 'string' || !isHex(id) || id.length !== 66) throw new DemoError(400, 'Bad invoice id.')
    if (typeof network !== 'string' || !(network in NETWORKS)) throw new DemoError(400, 'Unknown chain.')
    return send(res, 200, await payDemoInvoice(id, network as NetworkKey))
  } catch (error) {
    if (error instanceof DemoError) return send(res, error.status, { error: error.message })
    console.error(error)
    return send(res, 500, { error: 'The demo service hit an error. Try again.' })
  }
}
