// census: app_request_test, hc_client (violation hono-1-05)
// A request or client rooted at a sub-app that is ALSO mounted elsewhere is matched against that sub-app's
// own routes (relative to it), not the root's full paths.
import { Hono } from 'hono'
import api from './api'

const app = new Hono()
app.route('/api', api)

export default app
