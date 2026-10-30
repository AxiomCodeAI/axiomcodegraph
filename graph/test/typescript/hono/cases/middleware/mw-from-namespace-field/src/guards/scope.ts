import type { Context, Next } from 'hono'

export function scope(name: string) {
  const check = async (c: Context, next: Next) => {
    if (!c.get('user')) return c.text('denied ' + name, 403)
    await next()
  }
  return Object.assign(check, { scope: name })
}
