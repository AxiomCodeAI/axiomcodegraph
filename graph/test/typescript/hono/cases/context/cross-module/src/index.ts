// census: ctx_set, ctx_get, route_mount_literal
// The setter is in one module, the readers in a sub-app in another; the flow follows the mounted chain.
// A function that sets then reads the same key flows to itself (SPEC 3.4, j == i only when it reads after).
import { Hono } from 'hono'
import { session, type AuthEnv } from './auth'
import { account } from './routes'

const app = new Hono<AuthEnv>()
app.use('/account/*', session)
app.route('/account', account)

export default app
