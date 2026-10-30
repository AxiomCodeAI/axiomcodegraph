// census: verb_chained
// A path-less verb continues the previous path of the same app; the very first one is `/`.
import { Hono } from 'hono'

const app = new Hono()

app.get((c) => c.text('root, no path written'))

app
  .get('/book', (c) => c.text('list'))
  .post((c) => c.text('create'))
  .put((c) => c.text('replace'))

app.delete('/book/:id', (c) => c.text('gone')).patch((c) => c.text('patched'))

export default app
