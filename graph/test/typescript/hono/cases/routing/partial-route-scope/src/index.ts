// census: use_scoped, route_mount_nonliteral (SPEC 3.3 [iter2] partial_route_scope)
// A scoped use cannot be decided against routes mounted under an unknown prefix: declared, never "no middleware".
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const versioned: MiddlewareHandler = async (c, next) => { await next() }

const items = new Hono()
items.get('/list', (c) => c.json([]))

const VERSION = String(Date.now() % 3)
const app = new Hono()
app.use('/v1/*', versioned)
app.route(`/v${VERSION}`, items)

export default app
