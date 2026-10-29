// census: route_mount_literal, export_default_app
// A sub-app defined and default-exported in another module, mounted under a prefix.
import { Hono } from 'hono'
import users from './users'

const app = new Hono()

app.get('/', (c) => c.text('home'))
app.route('/users', users)

export default app
