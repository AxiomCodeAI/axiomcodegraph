// census: import_hono_named, route_mount_literal, use_global, export_default_app (ESM JavaScript)
// The TypeScript routing and composition shapes, written in ESM .js and .mjs with no types at all.
import { Hono } from 'hono'
import users from './users.mjs'

const audit = async (c, next) => {
  await next()
}

const app = new Hono()
app.use(audit)
app.get('/', (c) => c.text('home'))
app.route('/users', users)
app.get('/items/:id', audit, (c) => c.text(c.req.param('id')))

export default app
