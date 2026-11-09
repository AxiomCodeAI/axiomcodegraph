// census: serve_fetch
// Served with serve({ fetch: app.fetch }) from the node adapter; nothing is exported.
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()
app.get('/served', (c) => c.text('served'))

serve({ fetch: app.fetch, port: 8787 })
