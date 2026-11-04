// census: none (corpus gap). npm:hono@4 and npm:hono/cors specifiers: shape from Hono's Deno docs, corpus gap. Oracle maps them to the
// pinned hono types.
import { Hono } from 'npm:hono@4'
import { cors } from 'npm:hono/cors'

const app = new Hono()
app.use('/api/*', cors())
app.get('/api/npm', (c) => c.text('npm'))

Deno.serve({ port: 8000 }, app.fetch)
