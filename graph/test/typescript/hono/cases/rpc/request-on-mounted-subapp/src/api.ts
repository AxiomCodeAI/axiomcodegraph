import { Hono } from 'hono'

const api = new Hono()
api.get('/posts', (c) => c.json([]))
export const todos = new Hono().get('/todos', (c) => c.json([]))
api.route('/', todos)

export default api
