import { Hono } from 'hono'

export function registerGetMonitor(api: Hono) {
  api.get('/monitors/:id', (c) => c.json({ id: c.req.param('id') }))
}
export function registerListMonitors(api: Hono) {
  api.get('/monitors', (c) => c.json([]))
  api.post('/monitors', (c) => c.json({}, 201))
}
