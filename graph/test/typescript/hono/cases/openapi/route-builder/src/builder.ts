import { createRoute, type RouteConfig, type RouteHandler } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

export function requireKey(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.header('x-key')) return c.text('no key', 401)
    await next()
  }
}

// A route builder: the definition it is called with is the route, and `.handler(fn)` hands back both, for the app
// to register in one call: `app.openapi(ep.route, ep.handler)`.
export const defineEndpoint = <R extends RouteConfig>(config: R) => {
  const route = createRoute(config)
  const handler = (fn: RouteHandler<typeof route>) => ({ handler: fn, route: route })
  return { handler }
}

// A builder made per API version: the definition is spread into the one it builds, which adds the key check
export const versioned = (_version: string) => {
  const define = <R extends RouteConfig>(config: R) => {
    const route = createRoute({ ...config, middleware: [requireKey()] as const })
    const handler = (fn: RouteHandler<typeof route>) => ({ handler: fn, route })
    return { handler }
  }
  return { define }
}
