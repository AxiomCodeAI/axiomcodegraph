// census: on_method_array, on_method
// `on` with a verb list and a path list registers the cross product; a single custom verb too.
import { Hono } from 'hono'

const app = new Hono()

app.on(['GET', 'POST'], ['/form', '/form/legacy'], (c) => c.text('form'))
app.on('PURGE', '/cache/:key', (c) => c.text('purged'))
app.on(['put'], '/lower', (c) => c.text('upper-cased verb'))

export default app
