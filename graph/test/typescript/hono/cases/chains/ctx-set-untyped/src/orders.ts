// census: ctx_di (SPEC R18, the untyped form; call-chain break class 1)
// No Env type anywhere: the app is `new Hono()`. The only thing that says what `c.get('orders')` holds is the
// middleware's `c.set('orders', new OrderService(..))` on the chain that reaches the handler (ctx_key_flow), so
// calls on the value read back resolve to OrderService. The compiler types the read as any; the run-time trace
// observes the calls.
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
