// census: create_route, openapi_register, use_global
// routeDef.middleware runs before the validators and the handler; app-level use before that.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

const audit: MiddlewareHandler = async (c, next) => { await next() }
const guard: MiddlewareHandler = async (c, next) => { await next() }

const create = createRoute({
  method: 'post',
  path: '/notes',
  middleware: [guard] as const,
  request: { body: { content: { 'application/json': { schema: z.object({ text: z.string() }) } } } },
  responses: { 201: { description: 'created' } },
})

const app = new OpenAPIHono()
app.use(audit)
app.openapi(create, (c) => c.body(null, 201))

export default app
