import { Hono } from 'hono'

export function wrapApp(inner: Hono): Hono {
  const wrapper = new Hono()
  wrapper.use('*', async (c, next) => {
    c.header('x-wrapped', '1')
    await next()
  })
  wrapper.route('/', inner)
  return wrapper
}
