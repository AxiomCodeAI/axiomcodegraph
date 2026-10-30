// census: route_mount_root (SPEC R12.1; QD16 shape: a tier app mounting `mod.default` over a literal glob)
// import.meta.glob with a literal pattern is resolved against the files: every matched module's default-exported
// app is mounted by the loop's route() (eager by for..of over Object.values, lazy by awaiting each loader).
import { Hono } from 'hono'

const eagerRoutes = import.meta.glob<{ default: Hono }>('./routes/**/*.index.ts', { eager: true })
const lazyPages = import.meta.glob<() => Promise<{ default: Hono }>>('./lazy/*.page.ts')

const api = new Hono()
for (const mod of Object.values(eagerRoutes)) {
  api.route('/', mod.default)
}

export async function mountPages(app: Hono) {
  for (const key in lazyPages) {
    const mod = await lazyPages[key]()
    app.route('/pages', mod.default)
  }
}

const app = new Hono()
app.route('/api', api)
await mountPages(app)

export default app
