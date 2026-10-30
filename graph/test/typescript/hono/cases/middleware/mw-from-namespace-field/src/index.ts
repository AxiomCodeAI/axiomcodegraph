// census: use_global (stress-4 mutation m32 shapes; violation hono-4-01)
// Project middleware factories reached three ways: destructured from a field holding a namespace import, destructured
// from the namespace at module level, and as namespace members. Each is the inner project function, never a library
// call.
import { Hono } from 'hono'
import * as guards from './guards'

type Env = { Variables: { user: { id: string; optional: boolean } } }

class Controller {
  protected guards = guards
  getController() {
    const { session, scope } = this.guards
    const hono = new Hono<Env>().use(session(), scope('read'))
    hono.get('/info', (c) => c.json(c.get('user')))
    return hono
  }
}

const { session, scope } = guards
const reports = new Hono<Env>().use(session({ optional: true }), scope('reports'))
reports.get('/daily', (c) => c.json(c.get('user')))

const audit = new Hono<Env>().use(guards.session(), guards.scope('audit'))
audit.get('/log', (c) => c.json(c.get('user')))

const app = new Hono()
app.route('/api/system', new Controller().getController())
app.route('/api/reports', reports)
app.route('/api/audit', audit)
export default app
