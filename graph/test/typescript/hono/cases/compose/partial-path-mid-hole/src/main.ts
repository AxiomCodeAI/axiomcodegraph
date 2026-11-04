// census: route_mount_nonliteral, use_scoped, use_global (violation hono-7-05: a partial route whose unknown piece
// is in the MIDDLE of the path)
// The mount prefix is a template: the version is a const, the group name is a run-time value. Every route of the
// sub-app is partial with the known path /v1/{}/<local path>; the global use runs on it, the /v1/* scoped use is a
// declared unknown (SPEC 3.3), and no exact /v1/... route is guessed.
import { Hono } from 'hono'
import { system } from './system'

const VERSION = 'v1'

declare const process: { env: Record<string, string | undefined> }

const app = new Hono()
app.use('*', async (c, next) => {
  await next()
})
app.use(`/${VERSION}/*`, async (c, next) => {
  if (!c.req.header('authorization')) return c.text('no', 401)
  await next()
})
const group = process.env.GROUP ?? 'system'
app.route(`/${VERSION}/${group}`, system)
app.get('/health', (c) => c.text('ok'))

export default app
