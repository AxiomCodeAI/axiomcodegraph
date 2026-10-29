// census: basepath, route_mount_literal
// A sub-app built with basePath, then mounted: prefix + basePath + local path.
import { Hono } from 'hono'

const v1 = new Hono().basePath('/v1')
v1.get('/ping', (c) => c.text('pong'))

const app = new Hono()
app.route('/svc', v1)

export default app
