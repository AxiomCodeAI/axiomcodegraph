// census: none for CommonJS (corpus gap); CJS twin of js/negative-js
const { Hono } = require('hono')

const cache = new Map()
cache.set('/x', () => 'cached')
cache.get('/x')

const router = {
  get(path, fn) { return fn },
  use(fn) { return fn },
  route(path, other) { return other },
}
router.get('/not-hono', () => 'nope')
router.use(() => {})

const app = new Hono()
app.get('/real', (c) => c.text('real'))

module.exports = app
