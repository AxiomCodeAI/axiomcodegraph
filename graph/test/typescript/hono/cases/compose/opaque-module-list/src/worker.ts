import { Hono } from 'hono'

// a separate worker served on its own (its fetch is read): a served root, never a candidate
const worker = new Hono()
worker.get('/tick', (c) => c.text('tick'))

export default { fetch: worker.fetch }
