// census: create_route (stress-4 mutation m26 shape; violation hono-3-04 reopened)
// Responses keyed by a namespace constant (`[Status.OK]`) and written through helpers re-exported as named
// defaults from a barrel; routes and handlers come from namespace imports. Every slot names the helper's argument.
import { OpenAPIHono } from '@hono/zod-openapi'
import * as routes from './routes'
import * as handlers from './handlers'

const app = new OpenAPIHono()
  .openapi(routes.getTicket, handlers.getTicket)
  .openapi(routes.createTicket, handlers.createTicket)

export default app
