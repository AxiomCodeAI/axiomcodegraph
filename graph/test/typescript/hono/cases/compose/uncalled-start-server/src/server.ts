// census: app_factory_fn (oracle gap O2)
// The server is assembled inside a function no module in the program calls (its caller is a CLI outside it):
// the sub-app is mounted under /api, not served bare.
import { Hono } from 'hono'
import { api } from './api'

export function startServer(port: number) {
  const app = new Hono()
  app.route('/api', api)
  return { app, port }
}
