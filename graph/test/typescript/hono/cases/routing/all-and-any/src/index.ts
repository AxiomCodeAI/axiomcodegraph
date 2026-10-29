// census: verb_literal_path, path_wildcard
// `all` is verb ANY; an `all('*')` handler that never calls next is a handler, not middleware.
import { Hono } from 'hono'

const app = new Hono()

app.all('/proxy/*', (c) => c.text('proxied'))
app.get('/proxy/health', (c) => c.text('shadowed but registered'))

export default app
