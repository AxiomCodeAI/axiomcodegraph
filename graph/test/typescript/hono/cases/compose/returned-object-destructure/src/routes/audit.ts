import { Hono } from 'hono'

export function buildAuditRoutes(): Hono {
  const audit = new Hono()
  audit.post('/flush', (c) => c.text('flushed'))
  return audit
}
