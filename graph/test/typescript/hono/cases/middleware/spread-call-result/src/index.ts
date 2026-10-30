// census: use_multi, mw_factory_returning_fn (violation hono-1-06)
// A spread of a project function's returned array literal is seen through: the chain is
// [limiter's inner fn (1), limiter's inner fn (2), after] before the handler, positions exact.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

function limiter(n: number): MiddlewareHandler {
  return async (c, next) => {
    if (n < 0) return c.text('limited', 429)
    await next()
  }
}
function createLimits() {
  const a = limiter(1)
  const b = limiter(2)
  return [a, b]
}

const limits = createLimits()
const after: MiddlewareHandler = async (c, next) => {
  await next()
}

const app = new Hono()
app.use('*', ...limits)
app.use('*', after)
app.get('/x', (c) => c.text('x'))

export default app
