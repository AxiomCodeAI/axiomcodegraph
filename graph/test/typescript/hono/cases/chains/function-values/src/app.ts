import { Hono } from 'hono'
import { handlers, withRetry, tryit, run, readInput, pipeline, Mailer, purge } from './ops'

const app = new Hono()
const ACTION = 'restore'

// a callback passed to a project higher-order function
app.get('/retry/:id', (c) => c.text(withRetry(2, () => handlers.archive(c.req.param('id')))))
// a handler table read with a literal bracket key and with a const key
app.get('/table/:id', (c) => c.text(handlers['archive'](c.req.param('id')) + handlers[ACTION](c.req.param('id'))))
// a returned function, then called
app.get('/tryit/:id', (c) => c.text(tryit(purge)(c.req.param('id'))))
// a function stored in an options object
app.get('/options', (c) => c.text(run({ getInput: readInput })))
// an array element
app.get('/pipeline/:id', (c) => c.text(pipeline[1](c.req.param('id'))))
// a bound method
app.get('/mail/:to', (c) => {
  const send = new Mailer('ops').send.bind(new Mailer('noreply'))
  return c.text(send(c.req.param('to')))
})
// a key the program does not decide: a declared unknown
app.get('/act/:op/:id', (c) => {
  const op = c.req.param('op') as keyof typeof handlers
  return c.text(handlers[op](c.req.param('id')))
})

export default app
