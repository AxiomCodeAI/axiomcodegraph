// census: basepath (violation hono-3-01, SPEC R8a; holder read through a getter)
// The rebased holder is reached through a getter of another class, and the mounted app comes from a controller
// method: still ONE partial (dynamic_mount_prefix) per route, no exact row.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

class Modules {
  server = new Hono()
  constructor(private settings?: { prefix?: string }) {}
  reset() {
    this.server = new Hono()
    if (this.settings?.prefix) {
      this.server = this.server.basePath(this.settings.prefix)
    }
  }
}

class Kernel {
  modules = new Modules({ prefix: process.env.PREFIX })
  get server() {
    return this.modules.server
  }
}

class HealthController {
  getController() {
    const h = new Hono()
    h.get('/live', (c) => c.text('live'))
    h.post('/drain', (c) => c.text('drained'))
    return h
  }
  register(kernel: Kernel) {
    kernel.server.route('/internal/health', this.getController())
  }
}

const kernel = new Kernel()
kernel.modules.reset()
new HealthController().register(kernel)

export default { fetch: kernel.server.fetch }
