// census: reexport_default_as, route_mount_literal
// A sub-app reached through a barrel re-export (`export { default as x } from`).
import { Hono } from 'hono'
import { books } from './routes'

const app = new Hono()
app.route('/books', books)

export default app
