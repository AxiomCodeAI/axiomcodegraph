// census: mount_dynamic_prefix_call (stress-4 mutation m29 shape; violation hono-4-05)
// A loop mounts the elements of a const list by method calls whose prefix depends on a run-time version; another
// class with methods of the same names is mounted exactly elsewhere. Only the loop's element class is partial.
import { Hono } from 'hono'

declare const process: { env: Record<string, string | undefined> }

class HealthRoutes {
  private hono = new Hono()
  constructor() {
    this.hono.get('/health', (c) => c.text('ok'))
  }
  getBasePath(version: string) {
    return `/${version}/ops`
  }
  getRoutes() {
    return this.hono
  }
}

class AdminRoutes {
  private hono = new Hono()
  constructor() {
    this.hono.get('/signin', (c) => c.text('signin'))
  }
  getBasePath() {
    return '/admin'
  }
  getRoutes() {
    return this.hono
  }
}

const VERSION = process.env.API_VERSION ?? 'v1'
const app = new Hono()
const versioned = [new HealthRoutes()]
for (const r of versioned) {
  app.route(r.getBasePath(VERSION), r.getRoutes())
}
const admin = new AdminRoutes()
app.route(admin.getBasePath(), admin.getRoutes())

export default app
