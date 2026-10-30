// census: openapi_register, apptype_typeof (SPEC N6, N9)
// zod .openapi('Name') / .openapi({...}) metadata calls are not registrations, and a type alias of a
// createRoute value is not an RPC root. The one real registration is app.openapi.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const User = z.object({ id: z.string().openapi({ example: '1' }) }).openapi('User')
const Params = z.object({ id: z.string() }).openapi('Params')

const getUser = createRoute({
  method: 'get',
  path: '/users/{id}',
  request: { params: Params },
  responses: { 200: { description: 'a user', content: { 'application/json': { schema: User } } } },
})
export type GetUserRoute = typeof getUser

const app = new OpenAPIHono()
app.openapi(getUser, (c) => c.json({ id: c.req.valid('param').id }, 200))

export default app
