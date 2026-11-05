// census: use_global, route_mount_literal
// Middleware registered on a sub-app is mounted with it: scoped to the prefix, in its relative order.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const outer: MiddlewareHandler = async (c, next) => { await next() }
const inner: MiddlewareHandler = async (c, next) => { await next() }

const users = new Hono()
users.use(inner)
users.get('/', (c) => c.text('users'))

const app = new Hono()
app.use(outer)
app.route('/users', users)
app.get('/other', (c) => c.text('outer only'))

export default app
