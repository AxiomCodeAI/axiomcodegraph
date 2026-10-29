import { Hono } from 'hono'

const billing = new Hono().get('/invoices', (c) => c.json([]))
const search = new Hono().get('/query', (c) => c.json([]))

export const plugins = [
  { prefix: '/billing', app: billing },
  { prefix: '/search', app: search },
]
