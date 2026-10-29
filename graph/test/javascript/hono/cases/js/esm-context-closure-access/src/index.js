// census: ctx_set_in_callback, ctx_get_in_callback
// A middleware writes a key, and a handler reads one, inside callbacks nested in them: the callbacks
// run during the request with the outer function's context, so the key still flows.
import { Hono } from 'hono'

const app = new Hono()

app.use(async (c, next) => {
  await Promise.all([1].map(async () => c.set('user', 'u1')))
  c.set('role', 'admin')
  await next()
})
app.get('/', async (c) => {
  const user = await Promise.resolve().then(() => c.get('user'))
  const role = [0].map(() => c.var.role)[0]
  return c.json({ user, role })
})

export default app
