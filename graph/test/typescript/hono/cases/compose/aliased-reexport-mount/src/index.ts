// census: route_mount_literal (stress-4 mutation m30 shape; violation hono-4-06)
// The mounted app is an imported default re-exported under another name (`export { local as alias }`): it is the
// same app, mounted exactly at /api/search.
import { Hono } from 'hono'
import { searchApiRoutes } from './search'

const app = new Hono()
app.route('/api/search', searchApiRoutes)

export default app
