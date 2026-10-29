import { createMiddleware } from 'hono/factory'

export const audit = createMiddleware(async (c, next) => {
  await next()
  c.header('x-audited', '1')
})
