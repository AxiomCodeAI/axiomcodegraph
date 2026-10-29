// census: app_request_test (oracle gap O16; SPEC R1)
// Test apps mount sub-apps bound by `const { x } = await import('./m.ts')` (at module level and inside a test):
// the test apps are roots, the requests reach the mounted routes, nothing is unserved.
import { Hono } from 'hono'

declare function it(name: string, fn: () => unknown): void

const { skillsRoutes } = await import('./skills.ts')

const testApp = new Hono()
  .use('*', async (c, next) => {
    c.header('x-test', '1')
    await next()
  })
  .route('/', skillsRoutes)

it('reads a skill', async () => {
  await testApp.request('/acme/review')
})

it('publishes a skill', async () => {
  await testApp.request('/acme/review', { method: 'POST', body: '{}' })
})

it('reads admin stats', async () => {
  const { adminRoutes } = await import('./admin.ts')
  const app = new Hono().route('/admin', adminRoutes)
  await app.request('/admin/stats')
})
