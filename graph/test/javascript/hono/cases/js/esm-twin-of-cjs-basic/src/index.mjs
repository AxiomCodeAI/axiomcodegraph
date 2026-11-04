// census: new_hono, route_mount_literal, builtin_mw_import; ESM .mjs twin of js/cjs-basic
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import users from './users.mjs'

const app = new Hono()
app.use('/api/*', cors())
app.route('/api/users', users)
app.get('/health', (c) => c.text('ok'))

export default app
