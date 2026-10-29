// census: basepath (SPEC R8a/R8b, oracle note O27: a module-level app variable rebased under a condition)
// `let app = new Hono(); if (base) app = app.basePath(base)`: the routes registered through `app` afterwards are
// served at `<base>/...` when the variable is set and at `/...` when it is not, so neither exact path is known:
// every route on it is partial (dynamic_mount_prefix), never exact. The same holds for a LITERAL base behind a
// condition (`legacy`). A route registered BEFORE the rebase is on the un-rebased app and stays exact.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

const users = new Hono()
users.get('/:id', (c) => c.text(c.req.param('id')))

let app = new Hono()
app.get('/health', (c) => c.text('ok'))
const base = process.env.API_BASE
if (base) {
  app = app.basePath(base)
}
app.get('/version', (c) => c.text('1'))
app.route('/users', users)

let legacy = new Hono()
if (process.env.LEGACY_PREFIX === 'on') {
  legacy = legacy.basePath('/v1')
}
legacy.get('/ping', (c) => c.text('pong'))

export { legacy }
export default app
