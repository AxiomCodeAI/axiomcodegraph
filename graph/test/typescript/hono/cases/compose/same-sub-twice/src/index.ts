// census: route_mount_literal
// One sub-app mounted under two prefixes serves its routes under both.
import { Hono } from 'hono'

const health = new Hono()
health.get('/health', (c) => c.text('ok'))

const app = new Hono()
app.route('/a', health)
app.route('/b', health)

export default app
