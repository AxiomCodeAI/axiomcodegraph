// census: app_request_test, plugin_list_mount (SPEC R16 control; R6, R13b)
// The control for R16: ONE plugin module is mounted by the production app AND by a test's own app. Both apps
// really serve its routes, so its routes are rows on BOTH apps. A plugin only the test mounts stays on the test app;
// a plugin only production mounts stays on the production app.
import type { Hono } from 'hono'

export interface Plugin { name: string; routes?: { path: string; handler: Hono }[] }

export function mountPlugin(app: Hono, plugin: Plugin) {
  for (const route of plugin.routes ?? []) app.route(route.path, route.handler)
}

export function registerPlugins(app: Hono, plugins: Plugin[]) {
  for (const p of plugins.filter((x) => !!x.name)) mountPlugin(app, p)
}
