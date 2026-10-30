// census: create_route, openapi_register, new_openapihono (violation hono-7-03: routes built through a project
// wrapper around createRoute were dropped with no partial and no unknown; SPEC 3.2 "never dropped")
// Control: listRoute comes from createRoute directly. The wrapped DELETE and PATCH routes must be routes, each with
// its own scope check as route middleware at position 0, or partial/unknown with a reason; never absent.
import { OpenAPIHono } from '@hono/zod-openapi'
import items from './items'

const app = new OpenAPIHono()
app.route('/api/items', items)

export default app
