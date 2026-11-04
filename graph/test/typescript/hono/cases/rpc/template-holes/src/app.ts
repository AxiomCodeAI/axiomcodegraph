import { Hono } from 'hono'

export const app = new Hono()
  .get('/posts', (c) => c.json([]))
  .get('/posts/latest', (c) => c.json({}))
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))
