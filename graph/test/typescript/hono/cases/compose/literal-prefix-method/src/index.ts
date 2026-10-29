// census: mount_dynamic_prefix_call (violation hono-3-05, SPEC 3.2 G8)
// The mount prefix comes from a zero-argument method that returns a literal: it is that constant, so the routes
// are exact under /console. A method that builds its prefix from a field stays dynamic.
import { Hono } from 'hono'

class ConsoleRoutes {
  private hono = new Hono()
  constructor() {
    this.hono.get('/login', (c) => c.text('login'))
    this.hono.get('/home', (c) => c.text('home'))
  }
  getBasePath(): string {
    return '/console'
  }
  getRoutes() {
    return this.hono
  }
}

class VersionedRoutes {
  private hono = new Hono()
  private version: string
  constructor(version: string) {
    this.version = version
    this.hono.get('/items', (c) => c.json([]))
  }
  getBasePath(): string {
    return `/${this.version}`
  }
  getRoutes() {
    return this.hono
  }
}

const app = new Hono()
const ui = new ConsoleRoutes()
app.route(ui.getBasePath(), ui.getRoutes())
const v = new VersionedRoutes(String(Date.now()))
app.route(v.getBasePath(), v.getRoutes())

export default app
