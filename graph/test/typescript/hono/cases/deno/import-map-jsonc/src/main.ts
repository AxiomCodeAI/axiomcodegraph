// census: none (corpus gap). bare JSR name `@hono/hono` mapped by deno.jsonc (comments stripped): shape from Hono's Deno docs, corpus gap.
import { Hono } from '@hono/hono'

const app = new Hono()
app.get('/jsonc', (c) => c.text('jsonc'))

Deno.serve(app.fetch)
