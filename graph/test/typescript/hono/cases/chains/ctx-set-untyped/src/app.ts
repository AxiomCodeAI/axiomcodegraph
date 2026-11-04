import { Hono } from 'hono'
import { OrderRepo, OrderService } from './orders'

// handlers whose context parameter is `any` (the commonest untyped shape)
const app = new Hono()
app.use('/orders/*', async (c: any, next) => {
  c.set('orders', new OrderService(new OrderRepo()))
  await next()
})
app.get('/orders/list', (c: any) => {
  const orders = c.get('orders')
  return c.json(orders.list())
})

// an app whose Env is `any`: c.var.k is any too
const reports = new Hono<any>()
reports.use('*', async (c, next) => {
  c.set('orders', new OrderService(new OrderRepo()))
  await next()
})
reports.get('/total', (c) => c.json({ total: c.var.orders.total() }))
app.route('/reports', reports)

export default app
