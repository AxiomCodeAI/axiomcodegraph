import { makeApp } from './routes'

export class MemberRoutes {
  private routes = makeApp({ base: '/members' })
  prefix(v: string) {
    return `/${v}/members`
  }
  build() {
    this.routes.post('/import', (c) => c.text('ok'))
    this.routes.get('/:id', (c) => c.text(c.req.param('id')))
    return this.routes
  }
}
