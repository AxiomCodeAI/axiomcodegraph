// census: create_route, openapi_register, new_openapihono
// Route objects declared in another module; {id} registers as :id; the THIRD argument is a validation
// hook, not the handler.
import { OpenAPIHono } from '@hono/zod-openapi'
import { listTasks, getTask } from './routes'

const app = new OpenAPIHono()

app.openapi(listTasks, (c) => c.json([], 200))
app.openapi(
  getTask,
  (c) => c.json({ id: c.req.valid('param').id, done: false }, 200),
  (result, c) => {
    if (!result.success) console.log('rejected', c.req.path)
    return undefined
  }
)
app.doc('/doc', { openapi: '3.0.0', info: { title: 'tasks', version: '1' } })

export default app
