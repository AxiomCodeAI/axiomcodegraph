// census: app_request_test (violation hono-2-05, SPEC R9)
// The query string and fragment are stripped before matching: both requests reach the /file handler exactly.
import { app } from './app'

export async function withEncodedQuery(rel: string) {
  return app.request(`http://localhost/sessions/S1/file?path=${encodeURIComponent(rel)}`)
}
export async function withLiteralQuery() {
  return app.request('http://localhost/sessions/S1/file?path=..%2Fsecret.png#top')
}
