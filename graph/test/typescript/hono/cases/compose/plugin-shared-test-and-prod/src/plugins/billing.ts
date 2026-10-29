import { Hono } from 'hono'
import type { Plugin } from '../plugins'

const billing = new Hono()
billing.get('/invoices', (c) => c.json([]))

export const billingPlugin: Plugin = { name: 'billing', routes: [{ path: '/api/billing', handler: billing }] }
