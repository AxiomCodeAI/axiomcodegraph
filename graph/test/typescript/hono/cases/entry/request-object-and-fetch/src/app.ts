import { Hono } from 'hono'

export const app = new Hono()
app.get('/ping', (c) => c.text('pong'))
app.put('/items/:id', (c) => c.text('put'))
