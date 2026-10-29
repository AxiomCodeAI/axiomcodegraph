// census: use_scoped, path_wildcard (SPEC 3.3 [iter2] QD09 table, settled against the pinned hono routers)
// /x/* reaches /x, /x/ and /x/a but not /xy; /x* reaches /xy; a mid-path * is exactly one segment.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const slashStar: MiddlewareHandler = async (c, next) => { await next() }
const bareStar: MiddlewareHandler = async (c, next) => { await next() }
const midStar: MiddlewareHandler = async (c, next) => { await next() }

const app = new Hono()
app.use('/x/*', slashStar)
app.use('/x*', bareStar)
app.use('/a/*/c', midStar)

app.get('/x', (c) => c.text('x'))
app.get('/x/', (c) => c.text('x slash'))
app.get('/x/a', (c) => c.text('x a'))
app.get('/xy', (c) => c.text('xy'))
app.get('/a/b/c', (c) => c.text('one segment'))
app.get('/a/c', (c) => c.text('zero segments'))
app.get('/a/b/d/c', (c) => c.text('two segments'))

export default app
