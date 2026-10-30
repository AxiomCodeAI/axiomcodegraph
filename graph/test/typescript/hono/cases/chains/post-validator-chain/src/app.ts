import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { validator } from 'hono/validator'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Db, OrderRepo, OrderService } from './orders'

type Env = { Variables: { services: { orders: OrderService } } }

const createOrder = z.object({ sku: z.string(), qty: z.number() })

const provide: MiddlewareHandler<Env> = async (c, next) => {
  c.set('services', { orders: new OrderService(new OrderRepo(new Db())) })
  await next()
}

const app = new Hono<Env>()
app.use('/orders/*', provide)

// zValidator('json', schema) before the handler; destructured c.get('services')
app.post('/orders', zValidator('json', createOrder), async (c) => {
  const input = c.req.valid('json')
  const { orders } = c.get('services')
  return c.json({ id: orders.create(input) }, 201)
})

// the built-in validator('json', fn) with a hand-written check; c.var.services read inline
app.post(
  '/orders/:id/items',
  validator('json', (value, c) => {
    if (typeof value?.sku !== 'string') return c.text('sku required', 400)
    return { sku: value.sku as string }
  }),
  (c) => {
    const { sku } = c.req.valid('json')
    return c.json({ n: c.var.services.orders.addItem(c.req.param('id'), sku) })
  }
)

export default app
