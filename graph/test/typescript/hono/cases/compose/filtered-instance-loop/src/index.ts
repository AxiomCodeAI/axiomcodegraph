// census: route_mount_root (stress-5 mutation m36 shape; violation hono-5-01, SPEC R13b)
// A loop over a FILTERED list of known class instances mounts each one's `routes()` at a literal prefix: exact
// routes (the path is right whenever the module is enabled), each with conditional_registration.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

class Accounts {
  routes(): Hono {
    const h = new Hono()
    h.get('/accounts', (c) => c.text('accounts'))
    return h
  }
}
class Invoices {
  routes(): Hono {
    const h = new Hono()
    h.get('/invoices', (c) => c.text('invoices'))
    return h
  }
}

const enabled = (process.env.MODULES ?? '').split(',')
const modules = [new Accounts(), new Invoices()].filter((m) => enabled.includes(m.constructor.name))

const app = new Hono()
app.get('/', (c) => c.text('home'))
for (const m of modules) {
  app.route('/', m.routes())
}
export default app
