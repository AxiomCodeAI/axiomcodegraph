// census: ctx_set, ctx_get, ctx_var, create_middleware (ESM JavaScript)
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

const withUser = createMiddleware(async (c, next) => {
  c.set('user', { id: 'u1' })
  await next()
})

const app = new Hono()
app.use('/me/*', withUser)
app.get('/me/profile', (c) => c.json(c.get('user')))
app.get('/me/id', (c) => c.text(c.var.user.id))
app.get('/public', (c) => c.text(String(c.get('user'))))

export default app
