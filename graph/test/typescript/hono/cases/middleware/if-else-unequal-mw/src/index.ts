// census: use_conditional_loop, use_scoped (SPEC R15 clause 2)
// An if/else whose branches register DIFFERENT numbers of middleware on the same app: the branch middleware start
// at the same position (one of the two runs), each conditional; every LATER position on a chain that holds them is
// decided at run time, so that chain is declared dynamic_middleware_list (positions after the branch continue after
// the LONGER branch). A chain with no middleware after the branch is not dynamic; a chain the branch does not reach
// is untouched.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

declare const process: { env: Record<string, string | undefined> }

const requestId: MiddlewareHandler = async (c, next) => { c.header('x-request-id', '1'); await next() }
const verifyToken: MiddlewareHandler = async (c, next) => { await next() }
const loadUser: MiddlewareHandler = async (c, next) => { await next() }
const apiKey: MiddlewareHandler = async (c, next) => { await next() }
const audit: MiddlewareHandler = async (c, next) => { await next() }

const app = new Hono()
app.use('*', requestId)
if (process.env.AUTH_MODE === 'token') {
  app.use('/api/*', verifyToken)
  app.use('/api/*', loadUser)
} else {
  app.use('/api/*', apiKey)
}
app.use('/api/items/*', audit)

app.get('/health', (c) => c.text('ok'))
app.get('/api/ping', (c) => c.text('pong'))
app.get('/api/items/:id', (c) => c.json({ id: c.req.param('id') }))

export default app
