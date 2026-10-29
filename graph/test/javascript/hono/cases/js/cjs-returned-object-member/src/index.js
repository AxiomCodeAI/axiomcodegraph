// census: route_mount_literal, prop_receiver_route, require_hono (violation hono-7-01, P1 false_route; CommonJS)
// Sub-apps read as `rt.p` from the object a function returns. Control: distinct paths and handlers per sub-app,
// so a read that took the other property's value shows a route at the wrong prefix.
const { Hono } = require('hono')
const { createRuntime } = require('./runtime')

const rt = createRuntime('eu')

const app = new Hono()
app.route('/stock', rt.stockRoutes)
app.route('/orders', rt.orderRoutes)

module.exports = app
