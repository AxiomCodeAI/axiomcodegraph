import { Hono } from 'hono'
import { UserStore, AuditLog, saveAll } from './stores'

type Env = { Variables: { users: UserStore } }

const users = new UserStore()
const audit = new AuditLog()

const app = new Hono<Env>()
app.use('/typed/*', async (c, next) => {
  c.set('users', users)
  await next()
})
// a typed receiver: only UserStore.save
app.post('/typed/save', (c) => c.text(users.save('x')))
// through the typed context: only UserStore.save
app.post('/typed/ctx', (c) => c.text(c.var.users.save('x')))

// untyped: the c.set value decides (UserStore under 'store'; the AuditLog under another key is not it)
const loose = new Hono()
loose.use('*', async (c: any, next) => {
  c.set('store', new UserStore())
  c.set('log', new AuditLog())
  await next()
})
loose.post('/save', (c: any) => c.text(c.get('store').save('y')))
app.route('/loose', loose)

// the positive control: an interface call reaches both implementations
app.post('/all', (c) => c.json(saveAll([users, audit], 'z')))

export default app
