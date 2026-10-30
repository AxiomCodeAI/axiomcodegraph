// census: app_request_test, app_fetch_ref
// Tests that build a Request object, through app.request(new Request(...)) and app.fetch(req, env).
import { app } from './app'

export async function viaRequestObject() {
  const res = await app.request(new Request('http://localhost/ping'))
  return res.status
}

export async function viaFetchWithInit() {
  const res = await app.fetch(new Request('http://localhost/items/7', { method: 'PUT' }), { DB: 'test' })
  return res.status
}

export async function viaRequestWithInit() {
  const res = await app.request(new Request('http://localhost/items/8', { method: 'PUT' }))
  return res.status
}
