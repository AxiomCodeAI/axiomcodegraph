// census: create_route, openapi_register, new_openapihono (route builder: a project helper returns { route, handler }
// for each definition and the app registers both: app.openapi(ep.route, ep.handler); a plain builder and a version-scoped
// builder whose definition is spread into createRoute with the builder's own middleware).
// Look-alikes: an endpoint the builder made that nothing registers, and `.openapi(..)` on an object that is no app.
import { OpenAPIHono } from '@hono/zod-openapi'
import { draft, getItem, listItems } from './routes'

const docs = { openapi: (_route: unknown, _handler: unknown) => undefined }
const app = new OpenAPIHono()
app.openapi(getItem.route, getItem.handler)
app.openapi(listItems.route, listItems.handler)
docs.openapi(draft.route, draft.handler)

export default app
