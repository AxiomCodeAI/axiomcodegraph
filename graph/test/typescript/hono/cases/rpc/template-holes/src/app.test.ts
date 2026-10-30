// census: app_request_test, hc_element_param (SPEC 3.5 [iter2] template holes and absolute URLs)
// A `${id}` hole is exactly one segment: it matches /posts/:id AND /posts/latest by shape; a hole no route
// shape fits is dynamic_rpc_path, never unserved; an absolute URL uses its pathname.
import { hc } from 'hono/client'
import { app } from './app'

export async function oneByHole(id: string) {
  return app.request(`/posts/${id}`)
}
export async function clientByHole(id: string) {
  return (hc<typeof app>('http://api.example').posts as any)[id].$get()
}
export async function noShapeFits(id: string) {
  return app.request(`/comments/${id}`)
}
export async function absoluteUrl() {
  return app.request('http://localhost/posts')
}
