// census: request_fetch, app_request_test (SPEC R17; stress-6 oracle note O25; violation hono-6-03)
// A request whose HTTP method the program does not decide joins EVERY route on its composed path, on any verb,
// with Confidence method_unknown; when the base is also unknown, base_unknown wins. A literal method still joins
// only its own verb.
import { Hono } from 'hono'

const app = new Hono()
app.get('/api/skills/:id', (c) => c.json({ id: c.req.param('id') }))
app.put('/api/skills/:id', (c) => c.json({ ok: true }))
app.delete('/api/skills/:id', (c) => c.body(null, 204))
app.get('/_discovery', (c) => c.json([]))
app.post('/_discovery', (c) => c.json([]))

export default app
