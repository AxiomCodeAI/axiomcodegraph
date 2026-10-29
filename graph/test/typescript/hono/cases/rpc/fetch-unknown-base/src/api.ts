// census: request_fetch (SPEC R14; oracle gap O18)
// Requests whose base the program does not spell may reach this program's routes: they join on the composed full
// path with confidence base_unknown. A literal external host never joins.
import { Hono } from 'hono'

const app = new Hono().basePath('/api')
app.post('/oauth/register', (c) => c.json({ ok: true }, 201))
app.get('/projects/:id', (c) => c.json({ id: c.req.param('id') }))
app.get('/health', (c) => c.text('ok'))

export default app
