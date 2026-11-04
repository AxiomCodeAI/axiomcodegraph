// census: app_request_test (SPEC R13 / R13b; violation hono-4-09 and its silent menu-list control)
// Declarative `{ path, handler }` routes whose list is reordered or filtered at run time (a priority sort, a settings
// filter): the handler apps are mounted at their element path, EXACT (R13b; conditional_registration where the list
// is filtered), never roots at `/`. The `{ path, label }` menu entries are mounted by nothing and produce nothing.
import { Hono } from 'hono'
import { mountPlugin, type MountablePlugin } from './mount'

declare function it(name: string, fn: () => unknown): void

function makeRoute(label: string): Hono {
  const r = new Hono()
  r.get('/', (c) => c.text(label))
  return r
}

it('mounts one declarative route', async () => {
  const app = new Hono()
  const plugin: MountablePlugin = {
    name: 'solo',
    routes: [{ path: '/solo', handler: makeRoute('solo-ok') }],
    menu: [{ path: '/admin/solo', label: 'Solo' }],
  }
  mountPlugin(app, plugin)
})

it('mounts an inline sub-app', async () => {
  const app = new Hono()
  mountPlugin(app, { name: 'inline', routes: [{ path: '/inline', handler: new Hono().get('/', (c) => c.text('in')) }] })
})
