// Serves the built site and the demo wallet from one plain Node process.
//   npm run build && npm start        http://localhost:4173
//
// Two uses. It is the closest thing to production that runs on a laptop: the same built files and
// the same bundled function a serverless host would run. And it is a fallback: any host that can
// run `node` can run Till with this, with DEMO_PRIVATE_KEY set in its environment.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from '../api/demo/[action].js'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const port = Number(process.env.PORT || 4173)
if (!existsSync(join(dist, 'index.html'))) throw new Error('No dist/index.html. Run `npm run build` first.')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname.startsWith('/api/demo/')) return void handler(req, res)

  // Static files, never outside dist. Anything that is not a file is the single-page app.
  let file = normalize(join(dist, decodeURIComponent(pathname)))
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html')

  res.statusCode = 200
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
  // Built assets have a hash in their name, so they can be cached for good. The page itself cannot.
  res.setHeader('cache-control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`Till on http://localhost:${port}`)
  if (!process.env.DEMO_PRIVATE_KEY) console.log('DEMO_PRIVATE_KEY is not set, so "Watch one get paid" is hidden.')
})
