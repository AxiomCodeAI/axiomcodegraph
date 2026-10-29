// census: app_request_test, plugin_list_mount (SPEC R16; R6, R13b; violation hono-6-02)
// A plugin SDK: definePlugin copies `routes` and `register` from its input; mountPlugin mounts one plugin's
// priority-sorted routes and calls its register(app); registerPluginRoutes mounts a filtered, dependency-sorted list.
// Production and several tests each call these helpers on their OWN app. A route belongs only to the app that the
// call which brought its plugin was given: test plugins never reach the production app or another test's app.
import type { Hono } from 'hono'

export interface PluginRoute { path: string; handler: Hono; priority?: number }
export interface Plugin {
  name: string
  dependencies?: string[]
  routes?: PluginRoute[]
  register?: (app: Hono) => void
}
export interface MountLog { mounted: string[]; skipped: string[] }

export function definePlugin(input: { id: string; routes?: PluginRoute[]; register?: (app: Hono) => void }): Plugin {
  if (!input.id) throw new Error('id is required')
  return { name: input.id, routes: input.routes, register: input.register }
}

function byPriority(routes: PluginRoute[]): PluginRoute[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => (b.route.priority ?? 0) - (a.route.priority ?? 0) || a.index - b.index)
    .map((e) => e.route)
}

export function mountPlugin(app: Hono, plugin: Plugin, log?: MountLog): void {
  if (!plugin || !plugin.name) return
  if (Array.isArray(plugin.routes) && plugin.routes.length > 0) {
    for (const route of byPriority(plugin.routes)) {
      if (!route.path || !route.handler) continue
      app.route(route.path, route.handler)
      log?.mounted.push(route.path)
    }
  }
  if (typeof plugin.register === 'function') plugin.register(app)
}

function dependencyOrder<T extends Plugin>(plugins: ReadonlyArray<T>): T[] {
  const byName = new Map<string, T>()
  for (const p of plugins) byName.set(p.name, p)
  const out: T[] = []
  const done = new Set<string>()
  function visit(p: T): void {
    if (done.has(p.name)) return
    done.add(p.name)
    for (const d of p.dependencies ?? []) {
      const dep = byName.get(d)
      if (dep) visit(dep)
    }
    out.push(p)
  }
  for (const p of plugins) visit(p)
  return out
}

export function registerPluginRoutes(app: Hono, plugins: Array<Plugin | null>, opts: { sort?: boolean } = {}): MountLog {
  const log: MountLog = { mounted: [], skipped: [] }
  const kept = (opts.sort ?? true)
    ? dependencyOrder(plugins.filter((p): p is Plugin => !!p))
    : plugins.filter((p): p is Plugin => !!p)
  for (const plugin of kept) {
    const before = log.mounted.length
    mountPlugin(app, plugin, log)
    if (log.mounted.length === before) log.skipped.push(plugin.name)
  }
  return log
}
