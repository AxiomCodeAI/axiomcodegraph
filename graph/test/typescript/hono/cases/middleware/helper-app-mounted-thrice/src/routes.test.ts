// census: app_request_test (stress-4 mutation m28 shape; violation hono-4-02, SPEC R6)
// A test helper builds a fresh app per call and a second helper mounts the same routes into it; three tests do so.
// Each call is its own app: the chain is [use 0, param validator 1, json validator 2] on every one, never positions
// accumulated across calls.
import { Hono } from 'hono'
import { profileRoutes } from './routes'

declare function it(name: string, fn: () => unknown): void

function makeTestApp() {
  const app = new Hono<{ Variables: { actor: string } }>()
  app.use('*', async (c, next) => {
    c.set('actor', 'tester')
    await next()
  })
  return { app }
}

function mountRoutes(app: Hono<{ Variables: { actor: string } }>) {
  app.route('/', profileRoutes)
  return app
}

it('renames one', async () => {
  const { app } = makeTestApp()
  mountRoutes(app)
  await app.request('/1/rename', { method: 'POST' })
})

it('renames two', async () => {
  const { app } = makeTestApp()
  mountRoutes(app)
  await app.request('/2/rename', { method: 'POST' })
})

it('renames three', async () => {
  const { app } = makeTestApp()
  mountRoutes(app)
  await app.request('/3/rename', { method: 'POST' })
})
