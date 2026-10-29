// census: mount_foreign, use_scoped (oracle gap O8)
// A mount() handler is a route (ANY prefix/*) with a middleware chain like any other route.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'

const legacyAuth: MiddlewareHandler = async (c, next) => { await next() }
function legacyFetch(req: Request): Response {
  return new Response('legacy ' + req.url)
}

const app = new Hono()
app.use(cors())
app.use('/legacy/*', legacyAuth)
app.mount('/legacy', legacyFetch)

export default app
