import { Hono } from 'hono'
import { system } from './system'

const VERSION = 'v1'
declare const process: { env: Record<string, string | undefined> }

const app = new Hono()
app.use(`/${VERSION}/*`, async (c, next) => {
  if (!c.req.header('authorization')) return c.text('no', 401)
  await next()
})
const group = process.env.GROUP ?? 'system'
app.route(`/${VERSION}/${group}`, system)

export default app
