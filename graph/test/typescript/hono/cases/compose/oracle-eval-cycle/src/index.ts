// census: new_hono_inside_function (oracle gap O15)
// A large project's oracle run overflowed the stack on a destructure-and-rebuild cycle (saver.ts), and did not finish
// in 45 minutes on a long builder chain (cli.ts). The oracle must terminate, declare the value unknown, and still give
// the routes and middleware of the app around it.
import { Hono } from 'hono'
import { Saver, resume } from './saver'
import './cli'

const saver = new Saver()

const app = new Hono<{ Variables: { saver: Saver } }>()
app.use('/threads/*', async (c, next) => {
  c.set('saver', saver)
  await next()
})
app.post('/threads/:id/resume', async (c) => {
  const cfg = await resume(c.get('saver'), { configurable: { thread: c.req.param('id'), ns: '' } })
  return c.json(cfg)
})

export default app
