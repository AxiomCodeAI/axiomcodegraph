import { Hono } from 'hono'

export function buildOrderRoutes(label) {
  const orders = new Hono()
  orders.get('/recent', (c) => c.text(label()))
  orders.put('/:orderId', (c) => c.text('saved'))
  return orders
}
