// census: cjs_require_hono_destructure (oracle gap O10 residual, CommonJS)
// upgradeWebSocket comes from a PROJECT CommonJS module that destructures createBunWebSocket() and re-exports it in
// module.exports: the route's handler is the library call, keyed at the call.
const { Hono } = require('hono')
const containerRoutes = require('./routes/container')

const app = new Hono()
app.route('/api/containers', containerRoutes)

module.exports = app
