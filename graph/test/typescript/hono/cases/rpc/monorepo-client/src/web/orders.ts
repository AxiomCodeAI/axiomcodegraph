// census: hc_client, hc_dollar_call, hc_element_param
// The client lives in another package of the workspace and imports only the server's TYPE.
import { hc } from 'hono/client'
import type { Api } from '../server/app'

function makeClient() {
  return hc<Api>('/')
}

export async function cancelOrder(orderId: string) {
  const c = makeClient()
  return c.api.orders[':orderId'].cancel.$post({ param: { orderId } })
}
export async function listOrders() {
  return hc<Api>('/').api.orders.$get()
}
