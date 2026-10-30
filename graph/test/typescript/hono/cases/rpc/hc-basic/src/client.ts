// census: hc_client, hc_dollar_call, hc_element_param, apptype_typeof
// A typed client: each property is a path segment, [':id'] the literal param, index is `/`, $verb the call.
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:8787')

export async function listUsers() {
  return (await client.users.$get()).json()
}
export async function oneUser(id: string) {
  return (await client.users[':id'].$get({ param: { id } })).json()
}
export async function createUser() {
  return client.users.$post()
}
export async function home() {
  return client.index.$get()
}
export function userUrl() {
  return client.users[':id'].$url({ param: { id: '1' } })
}
