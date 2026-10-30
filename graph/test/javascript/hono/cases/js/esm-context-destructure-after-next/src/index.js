// census: ctx_set, ctx_get_destructured, ctx_set_after_next
// Untyped JavaScript: a middleware sets a key before handing on and another after the chain has
// returned; the handler reads the first by destructuring and asks for the second by name.
import { Hono } from 'hono'

const app = new Hono()

app.use(async (c, next) => {
  c.set('user', { id: 7 })
  await next()
  c.set('done', true)
})
app.get('/me', (c) => {
  const { user } = c.var
  return c.json({ id: user.id, done: c.get('done') })
})

export default app
