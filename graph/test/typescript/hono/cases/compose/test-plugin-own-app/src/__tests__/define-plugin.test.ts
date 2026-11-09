import { Hono } from 'hono'
import { definePlugin, registerPluginRoutes } from '../sdk'

declare function it(name: string, fn: () => unknown): void
declare function describe(name: string, fn: () => unknown): void
declare function expect(v: unknown): { toBe(x: unknown): void }

describe('definePlugin mounts like any plugin', () => {
  it('declarative routes mount through registerPluginRoutes', async () => {
    const sub = new Hono().get('/', (c) => c.text('defined'))
    const p = definePlugin({ id: 'routed', routes: [{ path: '/api/defined', handler: sub }] })
    const app = new Hono()
    registerPluginRoutes(app, [p])
    // oracle gap O26: a request inside an assertion's argument is still a request to THIS app
    expect(await (await app.request('/api/defined')).text()).toBe('defined')
  })

  it('register(app) runs at mount', async () => {
    const p = definePlugin({
      id: 'imperative',
      register(app) {
        app.route('/imp', new Hono().get('/', (c) => c.text('imp')))
      },
    })
    const app = new Hono()
    registerPluginRoutes(app, [p])
    expect((await app.request('/imp')).status).toBe(200)
  })
})
