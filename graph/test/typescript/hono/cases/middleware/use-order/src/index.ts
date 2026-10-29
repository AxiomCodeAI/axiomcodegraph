// census: use_global, use_scoped, await_next
// Registration ORDER decides: routes registered before a later use('/*', auth) do NOT get auth.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

const timing = createMiddleware(async (c, next) => {
  await next()
})
const auth = createMiddleware(async (c, next) => {
  await next()
})

const app = new Hono()
app.use(timing)
app.get('/public', (c) => c.text('timing only'))
app.use('/*', auth)
app.get('/private', (c) => c.text('timing then auth'))
app.post('/private', (c) => c.text('timing then auth too'))

export default app
