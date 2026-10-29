// census: hc_client, route_mount_literal (oracle gap O3: workspace package imports in a monorepo)
// Packages import each other by workspace package name: the mount and the typed client both cross them.
import { hc } from 'hono/client'
import type { AppType } from '@acme/server'

const client = hc<AppType>('/')

export function ping() {
  return client.ping.$get()
}
export function adminUsers() {
  return client.admin.users.$get()
}
