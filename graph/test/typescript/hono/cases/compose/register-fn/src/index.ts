// census: app_factory_fn
// The app reaches its routes through registration functions: a parameter typed `Hono`, and one typed
// `typeof <app>`; the callee's registrations are spliced in at the call.
import { Hono } from 'hono'
import { registerUsers } from './users'
import { monitorsApi, registerMonitorRoutes } from './monitors'

const app = new Hono()
app.get('/', (c) => c.text('first'))
registerUsers(app)
registerMonitorRoutes(monitorsApi)
app.route('/v1', monitorsApi)
app.get('/last', (c) => c.text('last'))

export default app
