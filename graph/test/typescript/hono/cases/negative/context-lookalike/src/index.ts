// census: ctx_get (partition outside Hono contexts) (SPEC N5)
// set/get on a Map called `c` is not a context key flow, even inside a file with a real app.
import { Hono } from 'hono'

function remember(c: Map<string, string>) {
  c.set('user', 'u1')
}
function recall(c: Map<string, string>) {
  return c.get('user')
}
const store = new Map<string, string>()
remember(store)
recall(store)

const app = new Hono()
app.get('/me', (c) => c.text('me'))

export default app
