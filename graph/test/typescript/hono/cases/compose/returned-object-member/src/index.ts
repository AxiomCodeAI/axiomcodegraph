// census: route_mount_literal, prop_receiver_route, app_factory_fn (violation hono-7-01, P1 false_route: sub-apps
// read out of an object a function returns)
// Member reads `rt.p` of the returned object. Control: the three sub-apps have distinct paths and handlers, so a
// read that took another property's value would show a route at the wrong prefix (e.g. GET /v1/stock/recent).
import { Hono } from 'hono'
import { createRuntime } from './runtime'

const rt = createRuntime('eu')

const app = new Hono()
const v1 = new Hono()
v1.route('/stock', rt.stockRoutes)
v1.route('/orders', rt.orderRoutes)
v1.route('/audit', rt.auditRoutes)
app.route('/v1', v1)

export default app
