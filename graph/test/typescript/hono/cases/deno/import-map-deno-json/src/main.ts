// census: route_mount_literal, export_default_app; bare 'hono' mapped by deno.json imports (exact and the
// "hono/" prefix map), .ts-extension relative imports, `export default app` run by `deno serve`.
// The one corpus Deno shape (deno.json import map). Oracle applies the import map.
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { users } from './routes/users.ts'

const app = new Hono()
app.use(secureHeaders())
app.route('/users', users)

export default app
