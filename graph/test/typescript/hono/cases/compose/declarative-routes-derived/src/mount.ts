import type { Hono } from 'hono'

export interface MountableRoute {
  path: string
  handler: Hono
  priority?: number
}
export interface MountablePlugin {
  name: string
  routes?: MountableRoute[]
  menu?: { path: string; label: string }[]
}

function byPriority(routes: MountableRoute[]): MountableRoute[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => (b.route.priority ?? 0) - (a.route.priority ?? 0) || a.index - b.index)
    .map((entry) => entry.route)
}

// mounts a plugin's declarative routes in priority order (decided at run time)
export function mountPlugin(app: Hono, plugin: MountablePlugin) {
  for (const route of byPriority(plugin.routes ?? [])) {
    if (!route.path || !route.handler) continue
    app.route(route.path, route.handler)
  }
}
