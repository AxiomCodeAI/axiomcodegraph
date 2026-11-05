import { Hono } from 'hono'

export const system = new Hono()
system.use('*', async (c, next) => {
  c.header('x-system', '1')
  await next()
})
system.get('/ping', (c) => c.text('pong'))
system.get('/status/:part', (c) => c.json({ part: c.req.param('part') }))
