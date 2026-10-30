// census: create_middleware, mw_factory_returning_fn, ctx_set, ctx_get (violation hono-1-07, JavaScript)
// In JavaScript as in TypeScript the middleware is the function passed to createMiddleware inside the project
// factory: it is the http entry, it is on the chain, and its c.set reaches the handler's c.get.
import { Hono } from 'hono'
import { sessionMiddleware } from './session.js'

const app = new Hono()
app.use(sessionMiddleware('k'))
app.get('/me', (c) => c.json(c.get('session')))

export default app
