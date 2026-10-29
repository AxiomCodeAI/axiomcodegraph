// census: ctx_set, ctx_get, ctx_next_in_branch
// A middleware that hands on early for some requests (`if (..) return next()`) and sets a key
// on the others: the set is before the `next()` that runs on its path, so the handler reads it.
import { Hono } from 'hono'

type Env = { Variables: { user: string; role: string } }
const app = new Hono<Env>()

app.use(async (c, next) => {
  if (c.req.path === '/health') return next()
  c.set('user', 'u1')
  await next()
})
app.use(async (c, next) => {
  if (c.req.header('x-skip')) {
    await next()
    return
  }
  c.set('role', 'admin')
  await next()
})
app.get('/', (c) => c.json({ user: c.get('user'), role: c.var.role }))

export default app
