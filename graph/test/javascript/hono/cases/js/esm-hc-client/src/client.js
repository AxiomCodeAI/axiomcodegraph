// census: hc_client, hc_dollar_call, hc_element_param (JavaScript: no type argument, SPEC 3.5 route_shape)
// A JS hc client has no AppType: it is matched by path against every served app in the JS graph.
import { hc } from 'hono/client'

const client = hc('http://localhost:8787')

export async function listTasks() {
  return client.tasks.$get()
}
export async function finishTask(id) {
  return client.tasks[':id'].done.$post({ param: { id } })
}
