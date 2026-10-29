// census: create_route, openapi_register, new_openapihono (violation hono-7-03; ESM JavaScript)
// A route built through a project wrapper around createRoute is a route (or partial/unknown with a reason), never
// dropped. Control: listRoute comes from createRoute directly.
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { scopedRoute } from './openapi.js'

const listRoute = createRoute({ method: 'get', path: '/', responses: { 200: { description: 'ok' } } })
const removeRoute = scopedRoute('items:delete', { method: 'delete', path: '/{id}', responses: { 204: { description: 'gone' } } })

const items = new OpenAPIHono()
items.openapi(listRoute, (c) => c.json([], 200))
items.openapi(removeRoute, (c) => c.body(null, 204))

const app = new OpenAPIHono()
app.route('/api/items', items)

export default app
