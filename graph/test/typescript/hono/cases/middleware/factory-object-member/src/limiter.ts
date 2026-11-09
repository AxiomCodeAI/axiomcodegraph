import type { MiddlewareHandler } from 'hono'

// The factory returns an object: the middleware is one property, a counter reader the other.
export function createLimiter(opts: { limit: number }) {
  let active = 0
  const middleware: MiddlewareHandler = async (c, next) => {
    if (active >= opts.limit) return c.text('busy', 503)
    active++
    try {
      await next()
    } finally {
      active--
    }
  }
  return { middleware, active: () => active }
}

export const limiter = createLimiter({ limit: 10 })
