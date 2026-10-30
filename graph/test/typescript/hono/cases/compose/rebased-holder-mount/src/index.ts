// census: basepath (violation hono-3-01, SPEC R8a)
// A sub-app mounted with route() into an app holder that a run-time basePath can rebase: its route is ONE partial
// (dynamic_mount_prefix) and never an exact row, exactly as a route registered on the holder directly.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

const status = new Hono()
status.get('/ping', (c) => c.text('pong'))

class Runtime {
  server = new Hono()
  constructor(private settings?: { prefix?: string }) {}
  reset() {
    this.server = new Hono()
    if (this.settings?.prefix) {
      this.server = this.server.basePath(this.settings.prefix)
    }
  }
}

const rt = new Runtime({ prefix: process.env.PREFIX })
rt.reset()
rt.server.route('/internal/status', status)

export default rt.server
