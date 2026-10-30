// census: use_global (oracle gap O14)
// Library middleware re-exported through a project barrel (`export { cors } from 'hono/cors'`, a renamed export,
// `export *`) is still the library middleware at its registering call, in order, with no dynamic list.
import { Hono } from 'hono'
import { audit, cors, requestLog, secureHeaders } from './middleware'

const app = new Hono()
app.use('*', requestLog())
app.use('*', cors({ origin: '*' }))
app.use('/api/*', secureHeaders(), audit)
app.get('/api/me', (c) => c.json({ id: 1 }))
app.get('/health', (c) => c.text('ok'))

export default app
