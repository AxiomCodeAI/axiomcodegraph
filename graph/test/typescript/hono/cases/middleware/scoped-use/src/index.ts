// census: use_scoped, path_wildcard
// Path-scoped middleware applies to the routes its pattern matches; a param segment in the scope matches any segment.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

const adminOnly: MiddlewareHandler = async (c, next) => {
  await next()
}
const perOrg: MiddlewareHandler = async (c, next) => {
  await next()
}

const app = new Hono()
app.use('/admin/*', adminOnly)
app.use('/orgs/:org/*', perOrg)

app.get('/admin/users', (c) => c.text('admin'))
app.get('/admin/users/:id', (c) => c.text('admin one'))
app.get('/orgs/:org/billing', (c) => c.text('billing'))
app.get('/public', (c) => c.text('public'))

export default app
