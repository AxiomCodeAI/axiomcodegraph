// census: verb_literal_path, verb_chained, on_method, export_default_app
// One app, every verb Hono generates, `all`, a custom method through `on`, and a chain.
import { Hono } from 'hono'

const app = new Hono()

app.get('/items', (c) => c.json([]))
app.post('/items', (c) => c.json({ created: true }, 201))
app.put('/items/:id', (c) => c.text('replaced'))
app.delete('/items/:id', (c) => c.body(null, 204))
app.patch('/items/:id', (c) => c.text('patched'))
app.options('/items', (c) => c.body(null, 204))
app.all('/health', (c) => c.text('ok'))
app.on('PURGE', '/cache', (c) => c.text('purged'))

app
  .get('/chain', (c) => c.text('get'))
  .post((c) => c.text('post on the same path'))

export default app
