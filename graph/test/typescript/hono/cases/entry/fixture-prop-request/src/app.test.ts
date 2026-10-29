// census: app_request_test (violation hono-2-06)
// A request on an app held in a property of the object a test helper returns reaches the route.
import { createApp } from './app'

declare function test(name: string, fn: () => Promise<void>): void

async function setupFixture() {
  const dir = '/tmp/x'
  return { dir, app: createApp(dir) }
}

test('flow', async () => {
  const fixture = await setupFixture()
  await fixture.app.request('http://localhost/api/flow')
})
