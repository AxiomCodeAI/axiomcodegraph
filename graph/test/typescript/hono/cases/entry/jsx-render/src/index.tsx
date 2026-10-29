/** @jsxImportSource hono/jsx */
// census: c_render, jsx_import
// hono/jsx components rendered through c.html, and c.render under jsxRenderer: SPEC 3.8 gives them no Hono
// semantics, so the handlers are routes and entries, jsxRenderer is middleware, and the components are
// neither routes, middleware nor entries.
import { Hono } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'
import { Layout, Greeting } from './components'

const app = new Hono()
app.get('/html', (c) => c.html(<Greeting name="html" />))
app.use('/page/*', jsxRenderer(({ children }) => <Layout>{children}</Layout>))
app.get('/page/hello', (c) => c.render(<Greeting name="render" />))

export default app
