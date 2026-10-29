import type { MiddlewareHandler } from 'hono'

export function rateLimit(opts: { max: number }): MiddlewareHandler {
  return async (c, next) => {
    if (opts.max < 0) return c.text('limited', 429)
    await next()
  }
}

export const requestId = (prefix: string): MiddlewareHandler => async (c, next) => {
  c.header('x-request-id', prefix)
  await next()
}
