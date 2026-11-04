// census: use_conditional_loop (stress-5 mutation m40 shape; violation hono-5-04)
// A library middleware registered in each branch of an if/else: both are on the chain with
// conditional_registration, each keyed at its own call.
import { Hono } from 'hono'
import { logger } from 'hono/logger'

declare const process: { env: Record<string, string | undefined> }

const app = new Hono()
if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger())
} else {
  app.use('*', logger((m: string) => console.error(m)))
}
app.get('/x', (c) => c.text('x'))
export default app
