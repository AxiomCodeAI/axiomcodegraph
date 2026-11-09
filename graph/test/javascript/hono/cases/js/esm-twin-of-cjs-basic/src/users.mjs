import { Hono } from 'hono'

const users = new Hono()
users.get('/:id', (c) => c.json({ id: c.req.param('id') }))

export default users
