// census: verb_literal_path (registrations behind a condition / in a loop, SPEC 3.1)
// Still emitted, each with a declared conditional_registration / loop_registration.
import { Hono } from 'hono'

const app = new Hono()
const debug = Date.now() < 0

if (debug) {
  app.get('/debug', (c) => c.text('debug only'))
} else {
  app.get('/prod', (c) => c.text('prod only'))
}

for (const name of ['a', 'b']) {
  app.get('/loop', (c) => c.text('registered per iteration ' + name))
}

app.get('/always', (c) => c.text('always'))

export default app
