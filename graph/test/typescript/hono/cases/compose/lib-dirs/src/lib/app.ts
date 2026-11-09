import { Hono } from 'hono'

export const app = new Hono()
app.get('/from-lib', (c) => c.text('declared under lib/'))
