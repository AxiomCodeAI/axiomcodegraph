import { Hono } from 'hono'

export function createRouter() {
  return new Hono()
}

export function createApp() {
  const app = createRouter()
  app.get('/ready', (c) => c.text('ready'))
  return app
}
