import { Hono } from 'hono'

export const adminRoutes = new Hono().get('/stats', (c) => c.json({ n: 0 }))
