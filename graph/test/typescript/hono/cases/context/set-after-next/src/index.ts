// census: ctx_set, ctx_get, ctx_set_after_next
// A middleware sets one key before handing on and another after the rest of the chain has
// returned: only the first is there when the handler reads it. The same middleware reads its
// late key back itself.
import { Hono } from 'hono'

type Env = { Variables: { started: number; finished: number } }
const app = new Hono<Env>()

app.use(async (c, next) => {
  c.set('started', Date.now())
  await next()
  c.set('finished', Date.now())
  c.header('x-elapsed', String(c.get('finished') - c.get('started')))
})
app.get('/', (c) => c.json({ started: c.var.started, finished: c.get('finished') }))

export default app
