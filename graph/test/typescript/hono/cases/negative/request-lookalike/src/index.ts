// census: app_request_test (partition where the receiver is not an app) (SPEC N7, N8)
// `.request()` on a test agent and a project function named hc: no remote edge to the route.
import { Hono } from 'hono'

const app = new Hono()
app.get('/real', (c) => c.text('real'))

const agent = { request(path: string) { return path } }
export function hitsWithAgent() {
  return agent.request('/real')
}

function hc<T>(base: string): any { return {} }
export function callsLocalHc() {
  return hc<typeof app>('/').real.$get()
}

export default app
