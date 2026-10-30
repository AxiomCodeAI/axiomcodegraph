import { Hono } from 'hono'

export const app = new Hono()
app.get('/sessions/:id/file', (c) => c.text('file'))
app.get('/sessions/:id/objective', (c) => c.text('objective'))
