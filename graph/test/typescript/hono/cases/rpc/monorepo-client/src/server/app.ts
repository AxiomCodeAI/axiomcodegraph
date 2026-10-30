import { Hono } from 'hono'

export const api = new Hono().basePath('/api')
  .get('/orders', (c) => c.json([]))
  .post('/orders/:orderId/cancel', (c) => c.json({ cancelled: c.req.param('orderId') }))

export type Api = typeof api
