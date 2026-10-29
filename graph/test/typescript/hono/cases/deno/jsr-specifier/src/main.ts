// census: deno_serve. jsr:@hono/hono and jsr:@hono/hono@^4/logger specifiers are a shape from Hono's Deno
// docs, corpus gap. The oracle maps jsr:/npm:/URL hono specifiers to the pinned hono types (oracle-only
// resolution host); the runtime half cannot load them under node and says so.
import { Hono } from 'jsr:@hono/hono'
import { logger } from 'jsr:@hono/hono@^4/logger'

const app = new Hono()
app.use(logger())
app.get('/jsr', (c) => c.text('jsr'))

Deno.serve(app.fetch)
