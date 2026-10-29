import { Hono } from 'hono'

export const app = new Hono()
  .get('/health', (c) => c.text('ok'))
  .post('/items', (c) => c.json({}, 201))
  .get('/items/:id', (c) => c.json({ id: c.req.param('id') }))
