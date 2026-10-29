// census: app_request_test (oracle gap O20; SPEC R13 / R13b)
// Plugin apps reach a mount only through a helper over a filtered, dependency-sorted list (a ternary of two
// filtered lists, a push-built result): each is mounted at its element's path, exact plus conditional, never a
// root at its own local paths.
import { Hono } from 'hono'
import { createApp } from './app'
import type { Plugin } from './mount'

declare function it(name: string, fn: () => unknown): void

function makeCustomPlugin(): Plugin {
  const routes = new Hono()
  routes.get('/', (c) => c.json({ custom: true }))
  return { id: 'custom', routes: [{ path: '/api/custom-test', handler: routes }] }
}

it('mounts a custom plugin', async () => {
  const app = createApp({ plugins: { register: [makeCustomPlugin()] } })
  await app.request('/api/custom-test')
})
