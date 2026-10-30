import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { Db, OrderService } from './services.js'

const provide = createMiddleware(async (c, next) => {
  c.set('services', { orders: new OrderService(new Db()) })
  await next()
})

const app = new Hono()
app.use('/orders/*', provide)

// destructured c.get(k), then a call on the member
app.get('/orders/:id', (c) => {
  const { orders } = c.get('services')
  return c.json(orders.find(c.req.param('id')))
})

// c.var.k read inline, two members deep
app.get('/orders/:id/total', (c) => c.json({ total: c.var.services.orders.total(c.req.param('id')) }))

export default app
