// census: route_mount_literal
// route() copies the sub-app's routes AT THE CALL: a registration on the sub-app after the mount
// is not served under the prefix.
import { Hono } from 'hono'

const sub = new Hono()
sub.get('/early', (c) => c.text('mounted'))

const app = new Hono()
app.route('/sub', sub)

sub.get('/late', (c) => c.text('registered after the mount: not under /sub'))

export default app
