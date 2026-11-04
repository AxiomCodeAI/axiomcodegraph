import { createFactory } from 'hono/factory'

type AdminEnv = { Variables: { role: string } }

export function createTierFactory<E extends object>() {
  return createFactory<E>()
}

const adminFactory = createTierFactory<AdminEnv>()
export const createAdminMiddleware = adminFactory.createMiddleware
export const createAdminHandlers = adminFactory.createHandlers
