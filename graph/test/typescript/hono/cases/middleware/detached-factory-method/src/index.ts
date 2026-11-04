// census: create_middleware (oracle gap O17)
// `createMiddleware` / `createHandlers` read off a factory into consts and called later: the middleware is the
// function passed in, at its chain position; the handlers spread into the route in order.
import { Hono } from 'hono'
import { createAdminHandlers, createAdminMiddleware } from './factory'

const requireAdmin = createAdminMiddleware(async (c, next) => {
  c.set('role', 'admin')
  await next()
})

const listUsers = createAdminHandlers(
  async (_c, next) => {
    await next()
  },
  (c) => c.json({ role: c.get('role') }),
)

const app = new Hono<{ Variables: { role: string } }>()
app.use('/admin/*', requireAdmin)
app.get('/admin/users', ...listUsers)

export default app
