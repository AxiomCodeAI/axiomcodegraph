// census: builtin_mw_import, mw_factory_returning_fn (violation hono-2-07, SPEC R10)
// A library middleware built with project callbacks in its options: the middleware is the library call; the
// callbacks are not middleware and have no chain position.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { basicAuth } from 'hono/basic-auth'
import type { MiddlewareHandler } from 'hono'

function guard(realm: string): MiddlewareHandler {
  return basicAuth({ realm, verifyUser: (user, pass) => user === 'a' && pass === 'b' })
}

const app = new Hono()
app.use('*', cors({ origin: (origin) => (origin.endsWith('.example') ? origin : null) }))
app.use('*', guard('admin'))
app.get('/x', (c) => c.text('x'))

export default app
