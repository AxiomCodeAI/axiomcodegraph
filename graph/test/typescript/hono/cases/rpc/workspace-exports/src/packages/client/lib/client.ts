// census: hc_client (violation hono-2-08; oracle gap O3: a workspace package subpath through package.json exports)
import { client as v2 } from '@scope/client/v2'

export function listSessions() {
  return v2.sessions.$get()
}
