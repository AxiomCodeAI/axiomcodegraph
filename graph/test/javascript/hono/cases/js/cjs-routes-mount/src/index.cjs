// census: none for CommonJS (corpus gap: no CJS Hono app in the corpus); CJS twin of js/esm-basic
// The same routes, middleware and mount written with require / module.exports in .cjs files.
const { Hono } = require('hono')
const users = require('./users.cjs')

const audit = async (c, next) => {
  await next()
}

const app = new Hono()
app.use(audit)
app.get('/', (c) => c.text('home'))
app.route('/users', users)
app.get('/items/:id', audit, (c) => c.text(c.req.param('id')))

module.exports = app
