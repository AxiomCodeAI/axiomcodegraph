// census: not_found, on_error
// notFound and onError handlers are http entry points, not routes.
import { Hono } from 'hono'

const app = new Hono()
app.get('/boom', () => {
  throw new Error('boom')
})
app.notFound((c) => c.text('custom 404', 404))
app.onError((err, c) => c.text(`custom 500: ${err.message}`, 500))

export default app
