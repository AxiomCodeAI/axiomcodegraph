// census: route_mount_literal, app_factory_fn (SPEC 2 [iter2] flow through fields; a class whose
// app lives in a field, registrations in setupRoutes() called from the constructor, a mount argument built by a method)
import { Hono } from 'hono'
import { health } from './routes/health'
import { UsersRoute } from './routes/users'

function createApp() {
  return new Hono().basePath('/v1')
}

export class Server {
  private app: ReturnType<typeof createApp>
  private extra: Hono = new Hono()

  constructor() {
    this.app = createApp()
    this.setupRoutes()
  }

  private setupRoutes() {
    this.app.route('/health', health)
    this.app.route('/users', new UsersRoute().getRoutes())
    this.extra.get('/extra', (c) => c.text('extra'))
  }

  get fetch() {
    return this.app.fetch
  }
}

export const server = new Server()
