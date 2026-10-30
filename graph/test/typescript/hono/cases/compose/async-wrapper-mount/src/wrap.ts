import { Hono } from 'hono'

export async function wrapApp(inner: Hono): Promise<Hono> {
  const wrapper = new Hono()
  wrapper.use('*', async (c, next) => {
    c.header('x-wrapped', 'async')
    await next()
  })
  wrapper.route('/', inner)
  return wrapper
}
