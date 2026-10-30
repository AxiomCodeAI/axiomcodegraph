// census: route_mount_nonliteral
// A mount prefix known only at run time is declared undetermined, never guessed.
import { Hono } from 'hono'

const tenants = new Hono()
tenants.get('/dashboard', (c) => c.text('dash'))

const prefix = ['/t', String(Date.now() % 3)].join('')
const app = new Hono()
app.route(prefix, tenants)
app.get('/static', (c) => c.text('static'))

export default app
