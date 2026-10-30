import { Hono } from 'hono'
import { definePlugin } from '../sdk'

const audit = new Hono()
audit.get('/', (c) => c.json([]))
audit.get('/:id', (c) => c.json({ id: c.req.param('id') }))

export const auditPlugin = definePlugin({ id: 'audit', routes: [{ path: '/admin/audit', handler: audit }] })
