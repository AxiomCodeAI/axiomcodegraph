// census: new_hono, route_mount_literal, builtin_mw_import (CommonJS JavaScript; SPEC 10 C2: no CJS project
// in the corpus, torture-only)
// require('hono') destructured, a library middleware by require, a sub-app from module.exports.
const { Hono } = require('hono')
const { cors } = require('hono/cors')
const users = require('./users')

const app = new Hono()
app.use('/api/*', cors())
app.route('/api/users', users)
app.get('/health', (c) => c.text('ok'))

module.exports = app
