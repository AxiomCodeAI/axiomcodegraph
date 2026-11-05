import { Hono } from 'hono'

export function invoiceRoutes(): Hono {
  const r = new Hono()
  r.get('/', (c) => c.json([]))
  r.delete('/:invoiceId', (c) => c.text('voided ' + c.req.param('invoiceId')))
  return r
}
