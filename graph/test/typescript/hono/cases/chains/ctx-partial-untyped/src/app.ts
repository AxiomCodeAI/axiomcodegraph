import { Hono } from 'hono'
import { OrderRepo, OrderService } from './orders'

declare const process: { env: Record<string, string | undefined> }

// the feature sub-app: no Env, its own provider middleware
const orders = new Hono()
orders.use('*', async (c: any, next) => {
  c.set('orders', new OrderService(new OrderRepo()))
  await next()
})
orders.get('/list', (c: any) => {
  const svc = c.get('orders')
  return c.json({ rows: svc.list(), tenant: String(c.get('tenant') ?? '') })
})
orders.get('/total', (c: any) => c.json({ total: c.var.orders.total() }))

// the served root mounts the feature at a prefix read from the environment (the default is only what an unset
// variable gives at run time); a scoped middleware on the root MAY apply, depending on that prefix
const app = new Hono()
app.use('/api/*', async (c: any, next) => {
  c.set('tenant', 't1')
  await next()
})
const prefix = process.env.ORDERS_PREFIX || '/api/orders'
app.route(prefix, orders)

export default app
