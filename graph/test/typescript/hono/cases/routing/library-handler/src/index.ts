// census: verb_literal_path (violation hono-1-03; SPEC R5)
// A route whose handler is a library call result: a route keyed at the call, never dropped.
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { serveStatic as serveStaticAlt } from 'hono/serve-static'

const app = new Hono()
app.get('/favicon.ico', serveStatic({ path: './favicon.ico' }))
app.all(
  '/assets/*',
  serveStaticAlt({ root: './public', getContent: async () => null })
)

export default app
