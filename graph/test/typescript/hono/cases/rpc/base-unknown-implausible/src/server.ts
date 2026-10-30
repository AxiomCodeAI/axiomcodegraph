// census: request_fetch, app_request_test (SPEC R14; oracle rule O21)
// Requests whose base the program does not spell join a route on the composed full path as base_unknown (R14), but
// four shapes join nothing: (1) a non-test request never reaches an app only a test builds; (2) a request that only
// a catch-all handler would match names no route; (3) `new URL(rel, import.meta.url)` is a file next to the module,
// not a request; (4) a path with no literal segment (`${base}/${key}`) names no route.
import { Hono } from 'hono'

const app = new Hono()
app.get('/api/users', (c) => c.json([]))
app.get('/api/users/:id', (c) => c.json({ id: c.req.param('id') }))
app.get('*', (c) => c.text('spa shell'))

export default app
