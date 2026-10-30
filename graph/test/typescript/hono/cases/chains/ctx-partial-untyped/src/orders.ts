// census: ctx_di on a rebased root, untyped (SPEC R23 with R18's setter-type form, on PARTIAL routes)
// No Env type: the only thing that says what `c.get('orders')` holds is the sub-app middleware's
// `c.set('orders', new OrderService(..))`. That middleware is in the partial routes' DECIDED chain (mwp), so the
// key flows to the handlers exactly as on an exact route (R23) and the calls on the value resolve to OrderService.
// The root's scoped `use('/api/*', ..)` only MAY apply under the unknown mount prefix: its `c.set('tenant', ..)` gives no
// flow row, and the reader of 'tenant' is no_setter_on_chain. The compiler types the reads as any; the run-time
// trace observes the calls.
export class OrderRepo {
  rows: string[]
  constructor() {
    this.rows = []
  }
  all() {
    return this.rows
  }
  count() {
    return this.rows.length
  }
}

export class OrderService {
  repo: OrderRepo
  constructor(repo: OrderRepo) {
    this.repo = repo
  }
  list() {
    return this.repo.all()
  }
  total() {
    return this.repo.count()
  }
}
