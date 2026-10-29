// census: route_mount_literal (violation hono-1-01; SPEC R2)
// route() on a receiver DECLARED as Hono (an interface property) whose value the program never shows: a mount
// on an app of unknown prefix. The child's route is partial (unresolved_app_value), never a root route at /raw.
import { Hono } from 'hono'

interface ServerCtx {
  server: Hono
}

class StatusController {
  getController() {
    const h = new Hono()
    h.get('/raw', (c) => c.text('raw'))
    return h
  }
}

export function register(ctx: ServerCtx) {
  ctx.server.route('/api/status', new StatusController().getController())
}
