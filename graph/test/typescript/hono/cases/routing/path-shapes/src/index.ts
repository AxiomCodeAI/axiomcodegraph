// census: path_param, path_optional_param, path_regex_param, path_wildcard
// Paths are kept as written: params, optional, regex, wildcard, a suffix after a param, a dot, a trailing slash.
import { Hono } from 'hono'

const app = new Hono()

app.get('/users/:id', (c) => c.text(c.req.param('id')))
app.get('/posts/:year?', (c) => c.text('posts'))
app.get('/items/:id{[0-9]+}', (c) => c.text('numeric item'))
app.get('/files/*', (c) => c.text('any file'))
app.get('/img/:slug.png', (c) => c.text('png'))
app.get('/v1/keys.getKey', (c) => c.text('dotted'))
app.get('/trailing/', (c) => c.text('trailing slash kept'))
app.get('/a/:x/b/:y', (c) => c.text('two params'))

export default app
