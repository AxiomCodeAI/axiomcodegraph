// census: use_global, use_scoped, mw_factory_returning_fn (violation hono-7-04: middleware read off the object a
// factory returns was keyed as the property-read expression, not as the function)
// limiter.middleware is the arrow in limiter.ts; m.auth and m.audit are the two functions in checks.ts, each on its
// own scope. Control: a cross-assignment would put audit on /admin/* or auth on every route.
import { Hono } from 'hono'
import { limiter } from './limiter'
import { makeChecks } from './checks'

const m = makeChecks('ops')

const app = new Hono()
app.use('*', limiter.middleware)
app.use('/admin/*', m.auth)
app.use('*', m.audit)
app.get('/ping', (c) => c.text('pong'))
app.get('/admin/users', (c) => c.json([]))

export default app
