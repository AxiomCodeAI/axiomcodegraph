// census: app_request_test, test_client
// Tests that hit routes through app.request and testClient: each test function reaches its route.
import { testClient } from 'hono/testing'
import { app } from './app'

export async function healthIsOk() {
  const res = await app.request('/health')
  return res.status === 200
}

export async function createsItem() {
  const res = await app.request('/items', { method: 'POST', body: '{}' })
  return res.status === 201
}

export async function readsOneItem() {
  const res = await app.request('/items/42')
  return res.status
}

export async function viaTestClient() {
  const client = testClient(app)
  const res = await client.health.$get()
  return res.status
}

export async function missesEveryRoute() {
  const res = await app.request('/nowhere')
  return res.status
}
