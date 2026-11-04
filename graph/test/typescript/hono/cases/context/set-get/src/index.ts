// census: ctx_set, ctx_get, ctx_var, variables_type
// A middleware sets keys on the context; handlers read them by c.get and c.var; a reader with no
// setter on its chain is declared, not linked.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

type Env = { Variables: { user: string; tenant: string; traceId: string } }

const loadUser = createMiddleware<Env>(async (c, next) => {
  c.set('user', 'u1')
  c.set('tenant', 't1')
  await next()
})

const app = new Hono<Env>()
app.get('/before', (c) => c.text(c.get('user') ?? 'no setter ran before this route'))
app.use(loadUser)
app.get('/me', (c) => c.text(c.get('user')))
app.get('/tenant', (c) => c.text(c.var.tenant))
app.get('/trace', (c) => c.text(c.var.traceId ?? 'never set'))

export default app
