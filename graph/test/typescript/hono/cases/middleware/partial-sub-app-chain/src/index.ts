// census: basepath (stress-4 mutation m34 shape; violation hono-4-03, SPEC 3.3 [iter2] partial routes)
// A controller with its own use(guard()) and a per-route middleware, mounted (through a getter) into a holder that a
// run-time basePath can rebase and that has a global use('*') and a scoped use('/api/*'). The route is partial; its
// decidable chain is [holder's use('*'), the controller's own use, the per-route middleware]; the scoped use is
// undecidable (partial_route_scope).
import { Hono } from 'hono'
import type { Context, Next } from 'hono'

declare const process: { env: Record<string, string | undefined> }

const guard = () => async (_c: Context, next: Next) => {
  await next()
}
const trace = async (_c: Context, next: Next) => {
  await next()
}
const audit = async (_c: Context, next: Next) => {
  await next()
}

class Controller {
  protected create(): Hono {
    return new Hono()
  }
  getController(): Hono {
    const hono = this.create().use(guard())
    hono.get('/config/raw', audit, (c) => c.text('raw'))
    return hono
  }
}

class Holder {
  server = new Hono()
  private opts?: { prefix?: string }
  constructor(opts?: { prefix?: string }) {
    this.opts = opts
  }
  rebuild() {
    this.server = new Hono()
    if (this.opts?.prefix) {
      this.server = this.server.basePath(this.opts.prefix)
    }
    this.server.use('*', trace)
    this.server.use('/api/*', guard())
  }
  get app() {
    return this.server
  }
}

const h = new Holder({ prefix: process.env.PREFIX })
h.rebuild()
h.app.route('/api/system', new Controller().getController())

export default h.server
