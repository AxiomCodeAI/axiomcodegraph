import { Hono } from 'hono'

const app = new Hono()
app.get('/tasks', (c) => c.json([]))
app.post('/tasks/:id/done', (c) => c.json({ id: c.req.param('id') }))

export default app
