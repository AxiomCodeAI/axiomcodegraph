// census: ctx_di (SPEC R18, the JavaScript form; call-chain break class 1)
// The JavaScript twin of the typed TypeScript chains: no types anywhere, so what `c.get('services')` holds is only
// the provider middleware's `c.set('services', ..)` on the chain (ctx_key_flow). The repository builds its own db
// handle from a constructor argument the compiler cannot type, so service -> repository resolves statically and
// repository -> db is observed at run time.
export class Db {
  get(key) {
    return [key]
  }
  sum(key) {
    return key.length
  }
}

export class OrderRepo {
  constructor(db) {
    this.db = db
  }
  byId(id) {
    return this.db.get(`order:${id}`)
  }
  total(id) {
    return this.db.sum(`order:${id}`)
  }
}

export class OrderService {
  constructor(db) {
    this.repo = new OrderRepo(db)
  }
  find(id) {
    return this.repo.byId(id)
  }
  total(id) {
    return this.repo.total(id)
  }
}
