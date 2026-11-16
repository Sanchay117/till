import { createDemoInvoice, respond } from '../../server/demo'

/** POST /api/demo/invoice: get a demo invoice to watch, creating one if none is open. */
export function POST(): Promise<Response> {
  return respond(createDemoInvoice)
}
