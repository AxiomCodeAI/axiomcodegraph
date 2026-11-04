// census: an import map keyed by the JSR name (@hono/hono) and its subpaths imported under that name
// (@hono/hono/factory): createMiddleware's argument is the middleware. Look-alike: a local module whose
// specifier only starts with the JSR name (@hono/hono-kit/factory): its createMiddleware is a project function.
import { Hono } from '@hono/hono'
import { createMiddleware } from '@hono/hono/factory'
import { createMiddleware as kitMiddleware } from '@hono/hono-kit/factory'

const auth = createMiddleware(async (c, next) => {
  await next()
})
const counted = kitMiddleware(async (c, next) => {
  await next()
})
const app = new Hono()
app.use('/admin/*', auth)
app.get('/admin/users', (c) => c.json([]))
app.get('/open', counted, (c) => c.text('open'))

Deno.serve(app.fetch)
