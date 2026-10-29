// census: prop_receiver_route (stress-4 mutation m25 shape; SPEC R2, hono-2-04 residue)
// A controller app mounted on a typed context holder at a prefix read through a getter of run-time config:
// ONE partial per route, never an exact row, never one row per hole depth.
import { Hono } from 'hono'

class BaseController {
  protected create(): Hono {
    return BaseController.createServer()
  }
  static createServer(): Hono {
    return new Hono()
  }
  getController(): Hono {
    return this.create()
  }
}

class AssetsController extends BaseController {
  override getController() {
    const hono = this.create()
    hono.delete('/asset/:name', (c) => c.body(null, 204))
    hono.get('/asset/:name', (c) => c.text(c.req.param('name')))
    return hono
  }
}

interface ServerCtx {
  server: Hono
}

class AssetsModule {
  private ctx: ServerCtx
  private config: { mountAt: string }
  constructor(ctx: ServerCtx, config: { mountAt: string }) {
    this.ctx = ctx
    this.config = config
  }
  get mountAt() {
    return this.config.mountAt
  }
  build() {
    this.ctx.server.route(this.mountAt, new AssetsController().getController())
  }
}

export function boot(ctx: ServerCtx, cfg: { mountAt: string }) {
  new AssetsModule(ctx, cfg).build()
}
