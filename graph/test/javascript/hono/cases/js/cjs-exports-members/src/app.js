// census: none for CommonJS (corpus gap in census; shape of a CJS-on-Bun project): oracle gap O7
// Middleware exported as `module.exports.x = fn` and imported by destructured require; a library middleware
// from a package the program cannot resolve stays in the chain.
const { Hono } = require('hono')
const { authenticate, isAdmin } = require('./auth')
const { limiter } = require('acme-rate-limit')

const app = new Hono()
app.use('/api/*', limiter({ max: 10 }))
app.use('/api/*', authenticate)
app.get('/api/me', (c) => c.json(c.get('user')))
app.delete('/api/users/:id', isAdmin, (c) => c.body(null, 204))

module.exports = app
