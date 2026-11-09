import { Hono } from 'hono'

export const system = new Hono()
system.get('/ping', (c) => c.text('pong'))
system.get('/status/:part', (c) => c.json({ part: c.req.param('part') }))
