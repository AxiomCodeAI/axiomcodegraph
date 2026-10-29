// census: route_mount_nonliteral (violation hono-2-01)
// Sub-apps returned by subclass overrides of an abstract method, mounted in a loop over a const map under a prefix
// made from the loop key: each is a mount argument (never a root). The map's entries are known, so each instance's
// own override runs under its own key (/oauth/callback, /password/login; the runtime half agrees).
import { Hono } from 'hono'

abstract class Strategy {
  abstract controller(): Hono
}
class OAuth extends Strategy {
  controller(): Hono {
    const h = new Hono()
    h.get('/callback', (c) => c.text('cb'))
    return h
  }
}
class Password extends Strategy {
  controller(): Hono {
    const h = new Hono()
    h.post('/login', (c) => c.text('in'))
    return h
  }
}

const strategies: Record<string, Strategy> = { oauth: new OAuth(), password: new Password() }
const app = new Hono()
for (const [name, s] of Object.entries(strategies)) {
  app.route(`/${name}`, s.controller())
}

export default app
