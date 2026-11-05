// census: builtin_mw_import
// Built-in middleware are library calls: each is a middleware node at its registering expression.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { etag } from 'hono/etag'

const app = new Hono()
app.use(logger())
app.use('/api/*', cors())
app.use('/api/*', secureHeaders(), etag())
app.get('/api/data', (c) => c.json({}))
app.get('/', (c) => c.text('home'))

export default app
