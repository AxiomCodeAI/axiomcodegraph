import { Hono } from 'hono'

// a sub-app in a subpath the package's `exports` does not list
export const adapters = new Hono()
adapters.get('/list', (c) => c.json([]))
