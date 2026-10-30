import { createFactory } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import type { Env } from './env'
import { Db } from './db'
import { UserRepo, KeyRepo } from './repos'
import { UserService, KeyService, AuditService } from './services'

const db = new Db()
export const factory = createFactory<Env>()

// MiddlewareHandler<Env>: the middleware that puts the services into the context
export const provide: MiddlewareHandler<Env> = async (c, next) => {
  c.set('services', { users: new UserService(new UserRepo(db)), keys: new KeyService(new KeyRepo(db)) })
  c.set('audit', new AuditService())
  await next()
}

// createFactory<Env>().createMiddleware: a middleware that reads a service back with c.var
export const auditTrail = factory.createMiddleware(async (c, next) => {
  c.var.audit.record(c.req.path)
  await next()
})
