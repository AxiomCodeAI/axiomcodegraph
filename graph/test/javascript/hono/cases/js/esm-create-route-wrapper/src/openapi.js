import { createRoute } from '@hono/zod-openapi'

export function authorize(scope) {
  return async (c, next) => {
    if (!scope) return c.text('no', 403)
    await next()
  }
}

// A project wrapper around createRoute that adds a scope check to the route's middleware.
export function scopedRoute(scope, config) {
  return createRoute({ ...config, middleware: [authorize(scope)] })
}
