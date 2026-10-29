import { Hono } from 'hono'

export class UsersRoute {
  getRoutes() {
    const r = new Hono()
    r.get('/:id', (c) => c.json({ id: c.req.param('id') }))
    return r
  }
}
