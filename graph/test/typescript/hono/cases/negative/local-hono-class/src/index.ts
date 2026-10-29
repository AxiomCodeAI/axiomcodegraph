// census: neg_route_on_nonhono (SPEC N4)
// A project class that happens to be called Hono, and .route() on a workflow builder: neither is an app.
class Hono {
  get(path: string, h: () => string) { return this }
  use(h: () => void) { return this }
  route(path: string, other: Hono) { return this }
}

const fake = new Hono()
fake.use(() => {})
fake.get('/fake', () => 'not a route')
fake.route('/nested', new Hono())

const workflow = {
  route(name: string, step: () => void) { step(); return this },
}
workflow.route('/step-one', () => {})

export default fake
