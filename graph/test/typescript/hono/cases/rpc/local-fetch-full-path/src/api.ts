import { Hono } from 'hono'

export const api = new Hono()
  .basePath('/api')
  .get('/ready', (c) => c.json({ ready: true }))
  .get('/version', (c) => c.json({ v: 1 }))
