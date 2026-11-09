import { Hono } from 'hono'

export function orderRoutes(): Hono {
  const r = new Hono()
  r.get('/', (c) => c.json([]))
  r.delete('/:orderId', (c) => c.text('cancelled ' + c.req.param('orderId')))
  return r
}
