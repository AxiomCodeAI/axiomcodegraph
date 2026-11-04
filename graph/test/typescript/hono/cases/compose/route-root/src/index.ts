// census: route_mount_root
// route('/', other) merges the other app's routes unprefixed; chained route() calls.
import { Hono } from 'hono'

const auth = new Hono()
auth.post('/login', (c) => c.text('in'))
auth.post('/logout', (c) => c.text('out'))

const misc = new Hono()
misc.get('/about', (c) => c.text('about'))

const app = new Hono()
const routes = app.route('/', auth).route('/', misc)

export type AppType = typeof routes
export default app
