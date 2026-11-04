// census: app_request_test (violation hono-7-02; ESM JavaScript)
// `post` sends with `method: 'POST'`: each call joins the POST route on its path, never GET. Control: `get`
// passes no init, so its call joins GET on the same path.
import { Hono } from 'hono'
import authRoutes from '../auth.js'

async function post(path, body) {
  const app = new Hono()
  app.route('/auth', authRoutes)
  const headers = { 'Content-Type': 'application/json' }
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function get(path) {
  const app = new Hono()
  app.route('/auth', authRoutes)
  return app.request(path)
}

it('logs in and reads the form', async () => {
  await post('/auth/login', { user: 'a' })
  await post('/auth/login/form', { user: 'a' })
  await get('/auth/login')
})
