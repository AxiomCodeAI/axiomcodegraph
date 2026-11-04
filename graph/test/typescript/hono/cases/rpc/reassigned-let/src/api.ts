import { Hono } from 'hono'

const api = new Hono()
api.get('/posts', (c) => c.json([]))
api.get('/posts/:id', (c) => c.json({}))
api.put('/posts/:id', (c) => c.json({}))

export default api
