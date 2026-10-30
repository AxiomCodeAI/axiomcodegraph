import { Hono } from 'hono'

const users = new Hono()
users.get('/', (c) => c.json([]))
users.post('/', (c) => c.json({}, 201))

export default users
