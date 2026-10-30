// census: route_mount_root (SPEC R12.1; oracle note O28: a brace alternative holding a `*` crashed the oracle)
// The glob's brace alternatives are globs themselves: `memory` literally, `*-store` by wildcard. Control: the
// legacy store matches neither alternative: it stays its own exported app (GET /legacy), never under /stores.
import { Hono } from 'hono'

const stores = import.meta.glob<{ default: Hono }>('./stores/{memory,*-store}/routes.ts', { eager: true })

const app = new Hono()
for (const mod of Object.values(stores)) {
  app.route('/stores', mod.default)
}

export default app
