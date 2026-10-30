import { Hono } from 'hono'
import { Db, UserRepo, UserService } from './users'

declare const process: { env: Record<string, string | undefined> }

type Env = { Variables: { services: { users: UserService } } }

// a feature sub-app with its own Env and its own provider middleware
const users = new Hono<Env>()
users.use('*', async (c, next) => {
  c.set('services', { users: new UserService(new UserRepo(new Db())) })
  await next()
})
users.get('/:id', (c) => {
  const { users } = c.get('services')
  return c.json(users.find(c.req.param('id')))
})
users.delete('/:id', async (c) => {
  const svc = c.var.services
  return c.json({ ok: svc.users.remove(c.req.param('id')) })
})

// the served root lives in a server holder that a run-time prefix rebases (the corpus's server-class shape)
class Server {
  app = new Hono()
  private prefix?: string
  constructor(prefix?: string) {
    this.prefix = prefix
  }
  build() {
    this.app = new Hono()
    if (this.prefix) {
      this.app = this.app.basePath(this.prefix)
    }
    return this
  }
}

const server = new Server(process.env.API_BASE).build()
server.app.route('/users', users)

export default server.app
