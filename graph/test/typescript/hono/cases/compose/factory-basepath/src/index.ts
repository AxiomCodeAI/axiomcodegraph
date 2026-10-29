// census: app_factory_fn, basepath (violation hono-1-02)
// An app returned from a function through basePath keeps its base: GET /v1/ping, and no base-less twin.
import { Hono } from 'hono'

function makeServer() {
  return new Hono().basePath('/v1')
}

const srv = makeServer()
srv.get('/ping', (c) => c.text('pong'))

export default srv
