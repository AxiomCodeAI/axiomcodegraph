import { Hono } from 'hono'
import type { Plugin } from '../mount'

const magic = new Hono()
magic.post('/request', (c) => c.json({ sent: true }))
magic.get('/verify', (c) => c.text('ok'))

export const magicLinkPlugin: Plugin = { id: 'magic-link', routes: [{ path: '/auth/magic-link', handler: magic }] }
