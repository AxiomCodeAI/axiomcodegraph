// census: route_mount_literal (SPEC R13: a const array of { path, handler } mounted in a loop)
// Declarative routes in a const array literal, mounted by `app.route(r.path, r.handler)` over that array: exact
// routes at the listed paths. A menu list of { path, label } that nothing mounts gives nothing.
import { Hono } from 'hono'

const tickets = new Hono().get('/', (c) => c.json([]))
const tags = new Hono().get('/:tag', (c) => c.text(c.req.param('tag')))

const routes = [
  { path: '/tickets', handler: tickets },
  { path: '/tags', handler: tags },
]

export const menu = [
  { path: '/admin/tickets', label: 'Tickets' },
  { path: '/admin/tags', label: 'Tags' },
]

const app = new Hono()
for (const r of routes) {
  app.route(r.path, r.handler)
}

export default app
