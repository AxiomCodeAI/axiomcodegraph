// census: app_factory_fn (SPEC 4 [iter2] route_registered_by: the method enclosing each registering call)
// Routes registered by two registration functions, through a mount, and at module level.
import { Hono } from 'hono'
import { registerGetMonitor, registerListMonitors } from './monitors'

const api = new Hono()
registerGetMonitor(api)
registerListMonitors(api)

const app = new Hono()
app.get('/', (c) => c.text('module level'))
app.route('/v1', api)

export default app
