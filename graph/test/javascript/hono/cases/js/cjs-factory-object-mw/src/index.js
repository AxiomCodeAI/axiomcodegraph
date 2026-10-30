// census: use_global, use_scoped, mw_factory_returning_fn, require_hono (violation hono-7-04; CommonJS)
// m.auth and m.audit are the two functions in checks.js, each on its own scope. Control: a cross-assignment
// would put audit on /admin/* only or auth on every route.
const { Hono } = require('hono')
const { makeChecks } = require('./checks')

const m = makeChecks('ops')

const app = new Hono()
app.use('/admin/*', m.auth)
app.use('*', m.audit)
app.get('/ping', (c) => c.text('pong'))
app.get('/admin/users', (c) => c.json([]))

module.exports = app
