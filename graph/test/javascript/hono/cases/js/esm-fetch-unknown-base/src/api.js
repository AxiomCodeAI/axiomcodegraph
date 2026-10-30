// census: request_fetch (violation hono-5-09, SPEC R14 / R14a in JavaScript)
// Requests whose base the program does not spell join on the composed full path as base_unknown; a single-label
// host joins as base_unknown; a dotted external host never joins.
import { Hono } from 'hono'

const app = new Hono().basePath('/api')
app.post('/sessions', (c) => c.json({ ok: true }, 201))
app.get('/sessions/:id', (c) => c.json({ id: c.req.param('id') }))

export default app
