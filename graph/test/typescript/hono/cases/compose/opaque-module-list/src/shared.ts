import { Hono } from 'hono'

// imported by the server: not a module-list candidate, mounted exactly
const shared = new Hono()
shared.get('/version', (c) => c.text('1'))

export default shared
