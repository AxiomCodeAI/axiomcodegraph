// census: verb_template_path (non-decidable partition)
// A path from a run-time value is declared undetermined, never guessed and never dropped.
import { Hono } from 'hono'

const app = new Hono()
const version = String(Date.now() % 2)

app.get(`/v${version}/status`, (c) => c.text('status'))
app.get('/fixed', (c) => c.text('fixed'))

export default app
