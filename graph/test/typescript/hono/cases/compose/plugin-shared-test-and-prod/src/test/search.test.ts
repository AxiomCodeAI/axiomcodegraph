import { Hono } from 'hono'
import { mountPlugin, type Plugin } from '../plugins'
import { searchPlugin } from '../plugins/search'

declare function it(name: string, fn: () => unknown): void

it('serves the search plugin on a bare app', async () => {
  const app = new Hono()
  mountPlugin(app, searchPlugin)
  await app.request('/api/search')
  await app.request('/api/search/reindex', { method: 'POST' })
})

it('serves a test-only plugin beside it', async () => {
  const probe = new Hono().get('/', (c) => c.text('probe'))
  const testOnly: Plugin = { name: 'probe', routes: [{ path: '/__probe', handler: probe }] }
  const app = new Hono()
  mountPlugin(app, searchPlugin)
  mountPlugin(app, testOnly)
  await app.request('/__probe')
  await app.request('/api/billing/invoices')
})
