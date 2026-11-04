// census: basepath (SPEC 2 [iter2]: a helper that discards basePath()'s result)
// basePath returns a NEW app; calling it as a statement changes nothing for later routes.
import { Hono } from 'hono'

function withVersion(app: Hono, version: string) {
  app.basePath(`/${version}`)
  return app
}

const app = withVersion(new Hono(), 'v2')
app.get('/items', (c) => c.json([]))

export default app
