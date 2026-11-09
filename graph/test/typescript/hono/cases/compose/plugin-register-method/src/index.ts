// census: route_mount_literal (oracle gap O11 residual; SPEC 2 a mount argument is never a root)
// Plugins mount their apps in a `register(app)` method of the object they hand to definePlugin; the host calls
// it over a FILTERED list of known plugins. R13b: each plugin app is mounted exactly at its literal prefix with
// conditional_registration, never a root.
import { Hono } from 'hono'
import type { PluginInput } from './sdk'
import { mediaPlugin } from './plugins/media'
import { variablesPlugin } from './plugins/variables'

declare const settings: { enabled: Set<string> }

export function mountPlugins(app: Hono, plugins: PluginInput[]) {
  for (const p of plugins) {
    p.register?.(app)
  }
}

const app = new Hono()
app.get('/', (c) => c.text('home'))
mountPlugins(app, [mediaPlugin, variablesPlugin].filter((p) => settings.enabled.has(p.id)))

export default app
