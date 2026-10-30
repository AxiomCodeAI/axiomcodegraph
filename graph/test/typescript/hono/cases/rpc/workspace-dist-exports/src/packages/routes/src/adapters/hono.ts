import { Hono } from 'hono'

export function dashboard(opts: { title: string }) {
  const ui = new Hono()
  ui.get('/', (c) => c.html(`<h1>${opts.title}</h1>`))
  ui.get('/api/activity', (c) => c.json([]))
  return ui
}
