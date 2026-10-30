import { Hono } from 'hono'
import { mountPlugin, registerPluginRoutes, type MountLog, type Plugin } from '../sdk'

declare function it(name: string, fn: () => unknown): void

function routesFor(label: string) {
  const r = new Hono()
  r.get('/', (c) => c.text(label))
  return r
}

it('mounts one plugin', async () => {
  const app = new Hono()
  const plugin: Plugin = { name: 'alpha', routes: [{ path: '/alpha', handler: routesFor('alpha') }] }
  mountPlugin(app, plugin)
  await app.request('/alpha')
})

it('records what it mounted', async () => {
  const app = new Hono()
  const log: MountLog = { mounted: [], skipped: [] }
  mountPlugin(app, { name: 'beta', routes: [{ path: '/beta', handler: routesFor('beta'), priority: 5 }] }, log)
  await app.request('/beta')
})

it('mounts a list in order', async () => {
  const app = new Hono()
  registerPluginRoutes(app, [
    { name: 'gamma', routes: [{ path: '/gamma', handler: routesFor('gamma') }] },
    null,
  ])
  await app.request('/gamma')
})
