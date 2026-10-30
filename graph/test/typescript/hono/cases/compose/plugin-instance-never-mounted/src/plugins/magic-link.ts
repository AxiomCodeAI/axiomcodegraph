// census: plugin_list_mount (oracle gap O24; SPEC R13 / R13b)
// A plugin factory builds its own app and writes it into a declarative route-list entry. The host calls the factory
// and mounts that instance under the entry's path. The module ALSO default-exports a second instance that nothing
// imports, mounts or serves: its app is never served at any path, so it gives no exact route (not a root at
// /request, /verify). The handlers are still served through the mounted instance.
import { Hono } from 'hono'

export interface Plugin { name: string; dependencies?: string[]; routes?: { path: string; handler: Hono }[] }

export function createMagicLinkPlugin(): Plugin {
  const routes = new Hono()
  routes.post('/request', (c) => c.json({ sent: true }))
  routes.get('/verify', (c) => c.text('verified'))
  return {
    name: 'magic-link',
    dependencies: ['email'],
    routes: [{ path: '/auth/magic-link', handler: routes }],
  }
}

export default createMagicLinkPlugin()
