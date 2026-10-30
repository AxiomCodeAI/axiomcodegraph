import { Hono } from 'hono'

const authRoutes = new Hono()
authRoutes.get('/login', (c) => c.text('form'))
authRoutes.post('/login', (c) => c.json({ ok: true }))
authRoutes.post('/login/form', (c) => c.text('ok'))
authRoutes.get('/session', (c) => c.json({ user: null }))

export default authRoutes
