import { Hono } from 'hono'

export const users = new Hono()
users.get('/', (c) => c.json([]))
users.get('/:id', (c) => c.json({ id: c.req.param('id') }))
