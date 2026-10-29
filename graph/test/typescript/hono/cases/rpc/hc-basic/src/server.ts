import { Hono } from 'hono'

const users = new Hono()
  .get('/', (c) => c.json([{ id: '1' }]))
  .get('/:id', (c) => c.json({ id: c.req.param('id') }))
  .post('/', (c) => c.json({ id: '2' }, 201))

const app = new Hono()
const routes = app.route('/users', users).get('/', (c) => c.text('index'))

export type AppType = typeof routes
export default app
