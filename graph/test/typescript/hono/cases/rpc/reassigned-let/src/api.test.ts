// census: app_request_test (violation hono-2-03, SPEC R7; oracle gap O13)
// A `let` reassigned in another test is not a constant: in the request path it is a one-segment hole.
import api from './api'

declare function test(name: string, fn: () => Promise<void>): void

let postId = ''
const fixed = 'p1'

test('create', async () => {
  postId = String(Date.now())
})
test('read', async () => {
  await api.request(`/posts/${postId}`)
})
test('update', async () => {
  await api.request(`/posts/${postId}`, { method: 'PUT' })
})
test('fixed', async () => {
  await api.request(`/posts/${fixed}`)
})
