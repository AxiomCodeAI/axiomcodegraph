import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { scopedRoute } from './openapi'

const listRoute = createRoute({ method: 'get', path: '/', responses: { 200: { description: 'ok' } } })
const removeRoute = scopedRoute('items:delete', {
  method: 'delete',
  path: '/{id}',
  responses: { 204: { description: 'gone' } },
})
const renameRoute = scopedRoute('items:write', {
  method: 'patch',
  path: '/{id}/name',
  responses: { 200: { description: 'renamed' } },
})

const items = new OpenAPIHono()
  .openapi(listRoute, (c) => c.json([], 200))
  .openapi(removeRoute, (c) => c.body(null, 204))
  .openapi(renameRoute, (c) => c.json({ ok: true }, 200))

export default items
