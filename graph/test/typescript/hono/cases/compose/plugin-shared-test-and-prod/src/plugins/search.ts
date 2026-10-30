import { Hono } from 'hono'
import type { Plugin } from '../plugins'

const search = new Hono()
search.get('/', (c) => c.json({ hits: [] }))
search.post('/reindex', (c) => c.text('queued', 202))

export const searchPlugin: Plugin = { name: 'search', routes: [{ path: '/api/search', handler: search }] }
