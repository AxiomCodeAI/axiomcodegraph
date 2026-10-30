import { Hono } from 'hono'
import type { IEnv } from './env'
import type { Env } from './env'
import { provide, auditTrail, factory } from './wire'
import { verifyKey, showUser } from './handlers'
import { Db } from './db'
import { UserRepo } from './repos'
import { UserService } from './services'

const app = new Hono<Env>()
app.use('*', provide)
app.use('/keys/*', auditTrail)
app.get('/keys/:key', verifyKey)

// inline Env generic, c.get(k).m() on the call result
app.get('/users/:id', (c) => c.json(c.get('services').users.find(c.req.param('id') ?? '')))

// a factory app with the same Env: handlers from createHandlers read c.var.services
const fapp = factory.createApp()
fapp.use('*', provide)
fapp.get('/whoami/:id', ...factory.createHandlers((c) => c.json(c.var.services.users.find(c.req.param('id') ?? ''))))
app.route('/f', fapp)

// an interface Env on a sub-app
const iapp = new Hono<IEnv>()
iapp.use('*', async (c, next) => {
  c.set('users', new UserService(new UserRepo(new Db())))
  await next()
})
iapp.get('/u/:id', showUser)
app.route('/i', iapp)

export default app
