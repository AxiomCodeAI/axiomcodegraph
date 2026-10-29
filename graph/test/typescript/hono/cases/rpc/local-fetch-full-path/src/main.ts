// census: route_mount_root (violation hono-3-02)
// A fetch to this machine is matched on the COMPOSED full paths: /ready is served only by the root app, the
// basePath'd sub-app serves /api/ready and /api/version.
import { Hono } from 'hono'
import { api } from './api'

const root = new Hono()
root.get('/ready', (c) => c.text('ok'))
root.route('/', api)

export default root
