import { Hono } from 'hono'
import { admin } from '@acme/admin/routes'

const app = new Hono()
const routes = app.get('/ping', (c) => c.text('pong')).route('/admin', admin)

export type AppType = typeof routes
export default app
