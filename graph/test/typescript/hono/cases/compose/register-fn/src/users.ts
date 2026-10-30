import { Hono } from 'hono'

export function registerUsers(app: Hono) {
  app.get('/users', (c) => c.json([]))
  app.post('/users', (c) => c.json({}, 201))
}
