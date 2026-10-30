import { Hono } from 'hono'

const billing = new Hono()
billing.get('/invoices', (c) => c.json([]))

export default billing
