// census: basepath
// basePath returns a NEW app sharing the route list: its routes get the prefix, the original app's do not.
import { Hono } from 'hono'

const app = new Hono()
const api = app.basePath('/api')
const v2 = api.basePath('/v2')

app.get('/', (c) => c.text('root has no prefix'))
api.get('/status', (c) => c.text('under /api'))
v2.get('/status', (c) => c.text('under /api/v2'))

export default app
