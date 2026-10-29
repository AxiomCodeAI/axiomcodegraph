// census: none for CommonJS (corpus gap); CJS twin of js/esm-context
const { Hono } = require('hono')
const { createMiddleware } = require('hono/factory')

const withUser = createMiddleware(async (c, next) => {
  c.set('user', { id: 'u1' })
  await next()
})

const app = new Hono()
app.use('/me/*', withUser)
app.get('/me/profile', (c) => c.json(c.get('user')))
app.get('/me/id', (c) => c.text(c.var.user.id))
app.get('/public', (c) => c.text(String(c.get('user'))))

module.exports = app
