import { createMiddleware } from 'hono/factory'

export function sessionMiddleware(secret) {
  return createMiddleware(async (c, next) => {
    c.set('session', { secret })
    await next()
  })
}
