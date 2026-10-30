// census: app_factory_fn (oracle gap O12)
// One registration function called with a known app and with an app of unknown prefix: the handler has its
// route, and is not also reported partial.
import { Hono } from 'hono'

interface Ctx { server: Hono }

export function registerMemory(api: Hono) {
  api.get('/memory', (c) => c.json({ used: 0 }))
}

const app = new Hono()
registerMemory(app)

export function wire(ctx: Ctx) {
  registerMemory(ctx.server)
}

export default app
