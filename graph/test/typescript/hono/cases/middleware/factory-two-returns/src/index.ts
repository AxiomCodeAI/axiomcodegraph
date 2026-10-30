// census: use_scoped (violation hono-3-03, SPEC 3.1 "resolve the return; if several, all", R10)
// A middleware factory returns a pass-through arrow in one branch and a library middleware otherwise: both are
// middleware of the chain at the same position; the library one is keyed at its call, its options callback is no
// middleware.
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { basicAuth } from 'hono/basic-auth'

declare const process: { env: Record<string, string | undefined> }

export function guard(realm: string) {
  if (process.env.NODE_ENV !== 'production') {
    return async (_c: Context, next: Next) => {
      await next()
    }
  }
  return basicAuth({ realm, verifyUser: (user, pass) => user === 'admin' && pass === realm })
}

const app = new Hono()
app.use('/admin/*', guard('ops'))
app.get('/admin/stats', (c) => c.json({ n: 1 }))
app.get('/public', (c) => c.text('hi'))

export default app
