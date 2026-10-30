// census: create_route, openapi_register, new_openapihono (ESM JavaScript; found with violation hono-7-03: the
// JavaScript engine registers no `.openapi(route, handler)` route at all)
// The TypeScript openapi/create-route shape without types: route objects from another module, {id} registers as
// :id, the third argument is a validation hook, not the handler.
import { OpenAPIHono } from '@hono/zod-openapi'
import { listNotes, getNote } from './routes.js'

const app = new OpenAPIHono()

app.openapi(listNotes, (c) => c.json([], 200))
app.openapi(
  getNote,
  (c) => c.json({ id: c.req.param('id') }, 200),
  (result, c) => {
    if (!result.success) return c.text('bad', 400)
  }
)

export default app
