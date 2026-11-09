import type { MiddlewareHandler } from 'hono'

// Two middleware in one returned object, one written inline: each read must take its own property's function.
export function makeChecks(realm: string) {
  const auth: MiddlewareHandler = async (c, next) => {
    if (!c.req.header('authorization')) return c.text(realm, 401)
    await next()
  }
  return {
    auth,
    audit: (async (c, next) => {
      await next()
      console.log(realm, c.req.path)
    }) as MiddlewareHandler,
  }
}
