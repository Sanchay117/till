import { demoInfo, respond } from '../../server/demo'

/** GET /api/demo/info: is the demo wallet available, and on which chains can it pay? */
export function GET(): Promise<Response> {
  return respond(demoInfo)
}
