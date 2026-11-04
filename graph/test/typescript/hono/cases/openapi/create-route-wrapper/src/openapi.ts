import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

export function authorize(scope: string): MiddlewareHandler {
  return async (c, next) => {
    if (!scope) return c.text('no', 403)
    await next()
  }
}

// A project wrapper around createRoute: it adds a scope check to the route's own middleware and returns
// createRoute's result. A route built through it is a route like any other.
export function scopedRoute<P extends string, T extends Omit<RouteConfig, 'path'> & { path: P }>(scope: string, config: T): T {
  const middleware = [authorize(scope), ...((config.middleware ?? []) as [])]
  return createRoute({ ...config, middleware } as T) as T
}
