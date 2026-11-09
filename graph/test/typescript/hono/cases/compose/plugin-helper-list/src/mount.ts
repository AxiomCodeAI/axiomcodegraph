import type { Hono } from 'hono'
import { topoSort } from './sort'

export interface Plugin {
  id: string
  dependencies?: string[]
  routes?: { path: string; handler: Hono }[]
}

export function mountPlugin(app: Hono, plugin: Plugin) {
  for (const route of plugin.routes ?? []) {
    if (!route.path || !route.handler) continue
    app.route(route.path, route.handler)
  }
}

export function registerPluginRoutes(app: Hono, plugins: Array<Plugin | undefined>, opts: { sort?: boolean } = {}) {
  const sorted = (opts.sort ?? true)
    ? topoSort(plugins.filter((p): p is Plugin => !!p))
    : plugins.filter((p): p is Plugin => !!p)
  for (const plugin of sorted) mountPlugin(app, plugin)
}
