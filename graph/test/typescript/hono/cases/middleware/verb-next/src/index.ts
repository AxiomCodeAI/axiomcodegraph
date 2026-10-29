// census: await_next, verb_literal_path
// A verb registration whose function takes next and calls it is middleware for later matching routes.
import { Hono } from 'hono'

const app = new Hono()
app.all('*', async (c, next) => {
  await next()
})
app.get('/x', (c) => c.text('x'))

export default app
