// census: app_request_test (violation hono-7-02: a literal method in the init object of app.request inside a
// test helper that takes the path from its callers)
// `post` sends with `method: 'POST'`: each call joins the POST route on its path, never GET. Control: `get`
// passes no init, so its calls join GET; both helpers reach /auth/login, each on its own verb.
import { Hono } from 'hono'
import authRoutes from '../auth'

declare function it(name: string, fn: () => unknown): void

async function post(path: string, body: Record<string, string>) {
  const app = new Hono()
  app.route('/auth', authRoutes)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const payload = JSON.stringify(body)
  return app.request(path, { method: 'POST', headers, body: payload }, { DB: 1 })
}

async function get(path: string) {
  const app = new Hono()
  app.route('/auth', authRoutes)
  return app.request(path)
}

it('logs in', async () => {
  await post('/auth/login', { user: 'a' })
  await post('/auth/login/form', { user: 'a' })
})

it('reads pages', async () => {
  await get('/auth/login')
  await get('/auth/session')
})
