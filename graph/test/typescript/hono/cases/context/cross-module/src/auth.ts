import { createMiddleware } from 'hono/factory'

export type AuthEnv = { Variables: { session: { id: string } } }

export const session = createMiddleware<AuthEnv>(async (c, next) => {
  c.set('session', { id: 's1' })
  await next()
})
