// census: use_global, use_multi (violation hono-1-06, LOOP form; SPEC 3.3 dynamic chains)
// Middleware registered in a loop over a run-time list sits between two known middleware: positions are the
// ordinal among the known ones, and the chain is declared dynamic_middleware_list.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

export function build(config: { before?: MiddlewareHandler[] }) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    await next()
  })
  if (config.before) {
    for (const m of config.before) {
      app.use('*', m)
    }
  }
  app.use('*', async (c, next) => {
    c.header('x-done', '1')
    await next()
  })
  app.get('/x', (c) => c.text('x'))
  return app
}

declare const loadedConfig: { before?: MiddlewareHandler[] }
export default build(loadedConfig)
