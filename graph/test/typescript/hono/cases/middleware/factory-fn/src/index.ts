// census: mw_factory_returning_fn, create_middleware
// A project middleware factory: the middleware is the INNER function the factory returns.
import { Hono } from 'hono'
import { rateLimit, requestId } from './mw'

const app = new Hono()
app.use(requestId('req'))
app.get('/limited', rateLimit({ max: 10 }), (c) => c.text('ok'))

export default app
