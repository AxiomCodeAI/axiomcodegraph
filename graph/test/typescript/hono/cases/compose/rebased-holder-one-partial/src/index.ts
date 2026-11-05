// census: prop_receiver_route (violation hono-2-04 residue, SPEC R8 / R8a)
// A holder rebuilt by a method that several call sites run (each rebuild may rebase it with a run-time prefix),
// with controllers mounted into it through a build context object. Each route is ONE partial with ONE reason
// (dynamic_mount_prefix), not one row per hole depth and not a second reason per route.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

interface BuildContext {
  server: Hono
}

class UsersController {
  getController() {
    const h = new Hono()
    h.get('/', (c) => c.json([]))
    h.get('/:id', (c) => c.json({ id: c.req.param('id') }))
    return h
  }
}

class Modules {
  server = new Hono()
  constructor(private options?: { basePath?: string }) {}
  private rebuildServer() {
    this.server = new Hono()
    if (this.options?.basePath) {
      this.server = this.server.basePath(this.options.basePath)
    }
  }
  ctx(rebuild?: boolean): BuildContext {
    if (rebuild) this.rebuildServer()
    return { server: this.server }
  }
  build() {
    this.rebuildServer()
    const ctx = this.ctx()
    ctx.server.route('/api/users', new UsersController().getController())
  }
}

const modules = new Modules({ basePath: process.env.BASE_PATH })
modules.ctx(true)
modules.build()

export default modules.server
