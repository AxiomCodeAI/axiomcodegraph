import { Hono } from 'hono'
import { createMagicLinkPlugin, type Plugin } from './plugins/magic-link'

function mountAll(app: Hono, plugins: Plugin[]) {
  for (const p of plugins.filter((x) => !!x.name)) {
    for (const r of p.routes ?? []) app.route(r.path, r.handler)
  }
}

export function createApp() {
  const app = new Hono()
  app.get('/', (c) => c.text('home'))
  const magicLink = createMagicLinkPlugin()
  mountAll(app, [magicLink])
  return app
}

export default createApp()
