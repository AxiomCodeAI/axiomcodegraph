import { Hono } from 'hono'

export function createApp(dir: string) {
  const app = new Hono()
  app.get('/api/flow', (c) => c.text(dir))
  return app
}
