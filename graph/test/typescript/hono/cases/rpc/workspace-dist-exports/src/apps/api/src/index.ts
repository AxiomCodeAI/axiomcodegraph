// census: route_mount_literal (oracle gap O3b)
// A workspace package whose `exports` point at an unbuilt ./dist/ file: in a checkout the import is the package's
// source (src/adapters/hono.ts), so the dashboard is mounted under /admin and is no root of its own.
import { Hono } from 'hono'
import { dashboard } from '@acme/routes/hono'

const app = new Hono()
app.get('/health', (c) => c.text('ok'))
app.route('/admin', dashboard({ title: 'Ops' }))

export default app
