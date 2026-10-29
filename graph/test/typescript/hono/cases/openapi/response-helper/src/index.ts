// census: create_route (violation hono-3-04, SPEC 3.9)
// createRoute responses written through a project helper that wraps the schema ({ content: { json: { schema } } }):
// the response schema of each route is the helper's ARGUMENT, as for an inline response.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const jsonBody = <T>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const jsonBodyRequired = <T>(schema: T, description: string) => ({
  ...jsonBody(schema, description),
  required: true,
})

const Account = z.object({ id: z.string(), email: z.string() })
const ErrorBody = z.object({ message: z.string() })
const AccountList = z.array(Account)

const getAccount = createRoute({
  method: 'get',
  path: '/accounts/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonBody(Account, 'the account'), 404: jsonBody(ErrorBody, 'not found') },
})
const listAccounts = createRoute({
  method: 'get',
  path: '/accounts',
  responses: { 200: { content: { 'application/json': { schema: AccountList } }, description: 'all' } },
})
const createAccount = createRoute({
  method: 'post',
  path: '/accounts',
  request: { body: jsonBodyRequired(Account, 'the new account') },
  responses: { 201: jsonBody(Account, 'created') },
})

const app = new OpenAPIHono()
app.openapi(getAccount, (c) => c.json({ id: c.req.valid('param').id, email: 'a@b' }, 200))
app.openapi(listAccounts, (c) => c.json([], 200))
app.openapi(createAccount, (c) => c.json(c.req.valid('json'), 201))

export default app
