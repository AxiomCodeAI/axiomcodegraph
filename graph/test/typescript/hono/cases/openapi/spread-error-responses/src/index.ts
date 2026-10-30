// census: create_route (stress-4 mutation m27 shape; violation hono-4-08, oracle gap O19)
// Error responses spread from a module-level object: each slot is the call `errorBody('...')` (named once, at the
// call), never the helper declaration as well.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { errorResponses } from './errors'

const Secret = z.object({ id: z.string() })

const getSecret = createRoute({
  method: 'get',
  path: '/secrets/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'the secret', content: { 'application/json': { schema: Secret } } },
    ...errorResponses,
  },
})

const app = new OpenAPIHono()
app.openapi(getSecret, (c) => c.json({ id: c.req.valid('param').id }, 200))
export default app
