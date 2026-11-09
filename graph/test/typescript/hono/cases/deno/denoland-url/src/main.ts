// census: none (corpus gap). https://deno.land/x/hono@v3.x/mod.ts and /middleware.ts: shape from Hono's Deno docs (v3 era), corpus gap.
// Oracle maps mod.ts to the pinned hono and middleware.ts to a re-export of its built-ins.
import { Hono } from 'https://deno.land/x/hono@v3.12.11/mod.ts'
import { etag } from 'https://deno.land/x/hono@v3.12.11/middleware.ts'

const app = new Hono()
app.use(etag())
app.get('/url', (c) => c.text('url'))

export default app
