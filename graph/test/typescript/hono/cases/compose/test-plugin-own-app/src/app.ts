import { Hono } from 'hono'
import { registerPluginRoutes } from './sdk'
import { auditPlugin } from './plugins/audit'
import { tenantsPlugin } from './plugins/tenants'

const corePlugins = [auditPlugin, tenantsPlugin]

export function createApp() {
  const app = new Hono()
  app.get('/health', (c) => c.text('ok'))
  registerPluginRoutes(app, corePlugins)
  return app
}

export default createApp()
