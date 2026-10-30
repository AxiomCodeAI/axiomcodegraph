import { Hono } from 'hono'
import { registerPluginRoutes, type Plugin } from './mount'
import { magicLinkPlugin } from './plugins/magic-link'

const coreAfterCatchAll: Plugin[] = [magicLinkPlugin]

export function createApp(config: { plugins?: { register?: Plugin[] } } = {}) {
  const app = new Hono()
  app.get('/', (c) => c.text('home'))
  if (config.plugins?.register) {
    registerPluginRoutes(app, config.plugins.register)
  }
  registerPluginRoutes(app, coreAfterCatchAll)
  return app
}
