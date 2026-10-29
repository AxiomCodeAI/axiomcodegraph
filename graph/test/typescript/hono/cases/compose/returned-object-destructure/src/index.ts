// census: route_mount_literal, app_factory_fn (violation hono-7-01, P1 false_route: sub-apps read out of an
// object a function returns)
// Destructured reads, one of them renamed. Control: the three sub-apps have distinct paths and handlers, so a
// name that took another property's value would show a route at the wrong prefix (e.g. DELETE /v1/orders/:sku).
import { Hono } from 'hono'
import { createRuntime } from './runtime'

const { stockRoutes, orderRoutes, auditRoutes: audit } = createRuntime('eu')

const app = new Hono()
const v1 = new Hono()
v1.route('/stock', stockRoutes)
v1.route('/orders', orderRoutes)
v1.route('/audit', audit)
app.route('/v1', v1)

export default app
