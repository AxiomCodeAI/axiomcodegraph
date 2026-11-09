// census: use_scoped (stress-4 mutation m31 shapes; violation hono-4-07, SPEC R10/R11)
// A library middleware bound to a const before use(): at module level, inside a builder, and inside a branch of a
// builder. Each is keyed at the jwt(...) call (library_call), never at the identifier.
import { Hono } from 'hono'
import { jwt } from 'hono/jwt'

declare const process: { env: Record<string, string | undefined> }

const api = new Hono()
const apiJwt = jwt({ alg: 'HS256', secret: process.env.SECRET ?? 'dev' })
api.use('/v1/*', apiJwt)
api.get('/v1/me', (c) => c.json({ me: true }))

export function buildAdmin(secret: string) {
  const admin = new Hono()
  const adminJwt = jwt({ alg: 'HS256', secret })
  admin.use('/admin/*', adminJwt)
  admin.get('/admin/users', (c) => c.json([]))
  return admin
}

export function buildPartner(cfg: { devMode: boolean; secret: string }) {
  const partner = new Hono()
  if (!cfg.devMode) {
    const partnerJwt = jwt({ alg: 'HS256', secret: cfg.secret })
    partner.use('/partner/*', partnerJwt)
  }
  partner.get('/partner/orders', (c) => c.json([]))
  return partner
}

api.route('/', buildAdmin(process.env.ADMIN_SECRET ?? 'dev'))
api.route('/', buildPartner({ devMode: false, secret: 'p' }))

export default api
