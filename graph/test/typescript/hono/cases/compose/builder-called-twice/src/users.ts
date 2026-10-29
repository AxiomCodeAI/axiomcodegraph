import { makeApp } from './routes'

export class UserRoutes {
  private routes = makeApp({ base: '/users' })
  prefix(version: string) {
    return `/${version}/users`
  }
  build() {
    this.routes.post('/import', (c) => c.text('ok'))
    return this.routes
  }
}
