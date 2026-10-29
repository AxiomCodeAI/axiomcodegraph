// census: verb_multi_handler, await_next
// Every argument but the last is per-route middleware; the last is the route handler.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const requireJson: MiddlewareHandler = async (c, next) => {
  await next()
}
const audit: MiddlewareHandler = async (c, next) => {
  await next()
}

function createOrder(c: any) {
  return c.json({ ok: true }, 201)
}

const app = new Hono()

app.post('/orders', requireJson, audit, createOrder)
app.get('/orders', audit, (c) => c.json([]))
app.get('/plain', (c) => c.text('no middleware'))

export default app
