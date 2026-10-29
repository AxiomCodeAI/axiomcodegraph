// census: openapi_register, create_route (violation hono-1-04)
// The handler is a member of a namespace import (`handlers.login`), the route object a named import whose
// path is a template over a literal.
import { OpenAPIHono } from '@hono/zod-openapi'
import * as handlers from './auth.handlers'
import { login } from './auth.routes'

const auth = new OpenAPIHono()
auth.openapi(login, handlers.login)

export default auth
