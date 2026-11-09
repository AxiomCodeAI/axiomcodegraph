// census: route_mount_root (stress-5 mutation m35b shape; violation hono-5-02, SPEC R6 and R13b)
// Controllers built through one static factory, each adding its own use() calls, mounted at '/' over a filtered
// list. Each call of the factory is its own app (R6): /reports gets only its own guard; /exports gets the reports
// guard first (mounted at '/', its `*` scope reaches later routes) and its own two, and since that first guard
// belongs to another, filtered element, the chain is declared dynamic. Routes are exact plus conditional.
import { Hono } from 'hono'
import type { Context, Next } from 'hono'

const guard = () => async (_c: Context, next: Next) => {
  await next()
}
const quota = () => async (_c: Context, next: Next) => {
  await next()
}

class Controller {
  protected create(): Hono {
    return Controller.createServer()
  }
  static createServer(): Hono {
    return new Hono()
  }
  getController(): Hono {
    return this.create()
  }
}
class Reports extends Controller {
  override getController() {
    const h = this.create().use(guard())
    h.get('/reports', (c) => c.text('reports'))
    return h
  }
}
class Exports extends Controller {
  override getController() {
    const h = this.create().use(guard()).use(quota())
    h.get('/exports', (c) => c.text('exports'))
    return h
  }
}

declare const flags: { has(name: string): boolean }

const app = new Hono()
const list: Controller[] = [new Reports(), new Exports()].filter((c) => flags.has(c.constructor.name))
for (const c of list) app.route('/', c.getController())
export default app
