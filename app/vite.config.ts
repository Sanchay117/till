import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * In production the files in /api run as serverless functions. In development this plugin serves the
 * same files from the Vite dev server, so the demo wallet works locally with no extra process.
 * Each file exports web-standard handlers: `export async function POST(request: Request): Promise<Response>`.
 */
function devApi(): Plugin {
  return {
    name: 'till-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (!path.startsWith('/api/')) return next()
        try {
          const mod = await server.ssrLoadModule(`${path.replace(/\/$/, '')}.ts`)
          const handler = mod[req.method ?? 'GET'] as ((request: Request) => Promise<Response>) | undefined
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
          const response = await handler(
            new Request(`http://localhost${req.url}`, {
              method: req.method,
              headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') },
              body: hasBody ? Buffer.concat(chunks) : undefined,
            }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          console.error(error)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'The demo service hit an error.' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
})
