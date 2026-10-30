import { Hono } from 'hono'

export const skillsRoutes = new Hono()
  .get('/:ns/:name', (c) => c.json({ ns: c.req.param('ns'), name: c.req.param('name') }))
  .post('/:ns/:name', (c) => c.json({ ok: true }, 201))
