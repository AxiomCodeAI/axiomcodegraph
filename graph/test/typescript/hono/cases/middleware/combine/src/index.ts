// census: combine_every_some_except
// hono/combine: the combinator call is the middleware node at its registering expression.
import { Hono } from 'hono'
import { every, some, except } from 'hono/combine'
import type { MiddlewareHandler } from 'hono'

const isAdmin: MiddlewareHandler = async (c, next) => { await next() }
const hasToken: MiddlewareHandler = async (c, next) => { await next() }
const isLocal: MiddlewareHandler = async (c, next) => { await next() }

const app = new Hono()
app.use('/admin/*', every(isAdmin, hasToken))
app.use('/ops/*', some(isLocal, hasToken))
app.use('*', except('/health', hasToken))
app.get('/admin/panel', (c) => c.text('panel'))
app.get('/ops/status', (c) => c.text('status'))
app.get('/health', (c) => c.text('ok'))

export default app
