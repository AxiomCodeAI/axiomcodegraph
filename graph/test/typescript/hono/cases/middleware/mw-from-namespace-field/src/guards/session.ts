import { createMiddleware } from 'hono/factory'

export const session = (options?: { optional?: boolean }) =>
  createMiddleware(async (c, next) => {
    c.set('user', { id: 'u1', optional: options?.optional ?? false })
    await next()
  })
