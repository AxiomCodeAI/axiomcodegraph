// census: mount_foreign
// mount() hands a prefix to a foreign fetch handler: verb ANY, path prefix/*, handler the function.
import { Hono } from 'hono'

function legacyFetch(req: Request): Response {
  return new Response('legacy ' + req.url)
}

const app = new Hono()
app.mount('/legacy', legacyFetch)
app.get('/new', (c) => c.text('new'))

export default app
