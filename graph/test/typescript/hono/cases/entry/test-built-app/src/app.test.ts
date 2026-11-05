// census: app_request_test (SPEC R1: oracle gap O1/O5)
// An app built INSIDE a test callback and exercised with app.request is a served root: its routes are
// http_route rows and the request reaches them.
import { Hono } from 'hono'

declare function describe(name: string, fn: () => void): void
declare function it(name: string, fn: () => Promise<void> | void): void

describe('health', () => {
  it('answers', async () => {
    const app = new Hono()
    app.get('/health', (c) => c.text('ok'))
    const res = await app.request('/health')
    if (res.status !== 200) throw new Error('down')
  })
})
