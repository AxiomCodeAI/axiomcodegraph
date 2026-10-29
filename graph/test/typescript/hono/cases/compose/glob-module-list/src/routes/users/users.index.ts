import { Hono } from 'hono'

const users = new Hono()
users.get('/users', (c) => c.json([]))
users.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))

export default users
