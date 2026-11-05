import { Hono } from 'hono'
import type { AuthEnv } from './auth'

export const account = new Hono<AuthEnv>()

account.get('/', (c) => c.json(c.get('session')))
account.delete('/', async (c, next) => {
  const s = c.var.session
  c.set('session', { id: '' })
  return c.json(s)
})
