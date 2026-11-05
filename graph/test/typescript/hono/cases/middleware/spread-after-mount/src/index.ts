// census: use_multi, route_mount_literal
// A const middleware array spread into use(); a use() AFTER mounting a sub-app does not reach the
// sub-app's routes, which were copied before it.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const a: MiddlewareHandler = async (c, next) => { await next() }
const b: MiddlewareHandler = async (c, next) => { await next() }
const protectedMiddleware = [a, b]

const sub = new Hono()
sub.get('/inside', (c) => c.text('mounted before the use'))

const routers = new Hono()
routers.route('/sub', sub)
routers.use(...protectedMiddleware)
routers.get('/after', (c) => c.text('gets a then b'))

export default routers
