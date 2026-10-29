// census: basepath (SPEC R8a/R8b control: an app variable re-pointed at a LITERAL basePath with no condition)
// `let app = new Hono(); app = app.basePath('/api')` always runs, so the base is known: every route registered through
// `app` afterwards is exact under /api; the one registered before the reassignment stays at its own path.
import { Hono } from 'hono'

const users = new Hono()
users.get('/:id', (c) => c.text(c.req.param('id')))

let app = new Hono()
app.get('/health', (c) => c.text('ok'))
app = app.basePath('/api')
app.get('/version', (c) => c.text('1'))
app.route('/users', users)

export default app
