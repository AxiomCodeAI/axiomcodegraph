// census: none (corpus gap). a standalone import_map.json mapping bare hono to npm:hono@4 (prefix map for hono/*): shape from Hono's
// Deno docs, corpus gap.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

const timer = createMiddleware(async (c, next) => {
  await next()
})
const app = new Hono()
app.use(timer)
app.get('/mapped', (c) => c.text('mapped'))

export default { fetch: app.fetch }
