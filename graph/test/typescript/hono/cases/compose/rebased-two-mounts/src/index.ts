// census: basepath (stress-4 mutation m33 shape; violations hono-3-01, hono-4-04)
// Two sub-apps mounted into a holder a run-time basePath can rebase, one at a literal prefix and one at a run-time
// prefix: every route is ONE partial (dynamic_mount_prefix), no exact rows.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

const settings = new Hono()
settings.get('/config/raw', (c) => c.text('raw'))
const callbacks = new Hono()
callbacks.post('/:provider', (c) => c.text(c.req.param('provider')))

class Server {
  app = new Hono()
  private opts?: { prefix?: string }
  constructor(opts?: { prefix?: string }) {
    this.opts = opts
  }
  reset() {
    this.app = new Hono()
    if (this.opts?.prefix) {
      this.app = this.app.basePath(this.opts.prefix)
    }
  }
}

const srv = new Server({ prefix: process.env.PREFIX })
srv.reset()
srv.app.route('/api/settings', settings)
srv.app.route(process.env.CALLBACK_PREFIX ?? '/callbacks', callbacks)

export default srv.app
