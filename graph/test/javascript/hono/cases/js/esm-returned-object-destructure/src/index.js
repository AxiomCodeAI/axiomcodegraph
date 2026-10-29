// census: route_mount_literal, app_factory_fn (violation hono-7-01, P1 false_route; ESM JavaScript)
// Sub-apps destructured from the object a function returns. Control: distinct paths and handlers per sub-app,
// so a name that took the other property's value shows a route at the wrong prefix.
import { Hono } from 'hono'
import { createRuntime } from './runtime.js'

const { stockRoutes, orderRoutes } = createRuntime('eu')

const app = new Hono()
app.route('/stock', stockRoutes)
app.route('/orders', orderRoutes)

export default app
