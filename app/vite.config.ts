import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * In production the demo wallet's handler runs as a serverless function (api/demo/[action].js) or
 * inside scripts/serve.mjs. In development this plugin calls the same handler, straight from its
 * TypeScript source, so the demo works with no extra process.
 */
function devApi(): Plugin {
  return {
    name: 'till-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/demo/')) return next()
        try {
          const { default: handler } = await server.ssrLoadModule('/server/handler.ts')
          await handler(req, res)
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
