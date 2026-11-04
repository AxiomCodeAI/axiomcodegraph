import { Hono } from 'hono'

declare function it(name: string, fn: () => unknown): void

it('serves a probe route on a test app', async () => {
  const app = new Hono()
  app.get('/__test/probe', (c) => c.text('probe'))
  await app.request('/__test/probe')
})
