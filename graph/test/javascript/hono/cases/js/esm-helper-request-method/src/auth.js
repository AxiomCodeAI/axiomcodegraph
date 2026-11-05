import { Hono } from 'hono'

const authRoutes = new Hono()
authRoutes.get('/login', (c) => c.text('form'))
authRoutes.post('/login', (c) => c.json({ ok: true }))
authRoutes.post('/login/form', (c) => c.text('ok'))

export default authRoutes
