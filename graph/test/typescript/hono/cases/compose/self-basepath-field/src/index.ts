// census: basepath (violation hono-2-04, SPEC R8)
// A self-referential update of an app field, behind a condition with a run-time base: evaluated once per
// textual assignment; the route is declared ONCE (partial, dynamic_mount_prefix), never exploded.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

class Manager {
  server = new Hono()
  rebuild(base?: string) {
    this.server = new Hono()
    if (base) {
      this.server = this.server.basePath(base)
    }
  }
}

const m = new Manager()
m.rebuild(process.env.BASE)
m.server.get('/x', (c) => c.text('x'))

export default m.server
