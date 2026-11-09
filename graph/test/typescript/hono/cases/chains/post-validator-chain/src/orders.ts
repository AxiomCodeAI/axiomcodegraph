// census: ctx_di + zvalidator + req_valid (SPEC R18 with SPEC 3.9; call-chain break class 1 on a POST route)
// The commonest write route in the corpus: a json validator runs before the handler, the handler reads the
// validated body with c.req.valid('json') and hands it to a service it reads out of the context. The chain is
// provider middleware -> (library validator) -> handler -> service -> repository -> db. At run time the handler
// is only entered when the request carries a JSON body the schema accepts (the golden's `body` rows).
export class Db {
  insert(table: string, row: object): number {
    return Object.keys(row).length + table.length
  }
}

export class OrderRepo {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }
  save(sku: string, qty: number) {
    return this.db.insert('orders', { sku, qty })
  }
  saveItem(orderId: string, sku: string) {
    return this.db.insert('order_items', { orderId, sku })
  }
}

export class OrderService {
  private repo: OrderRepo
  constructor(repo: OrderRepo) {
    this.repo = repo
  }
  create(input: { sku: string; qty: number }) {
    return this.repo.save(input.sku, input.qty)
  }
  addItem(orderId: string, sku: string) {
    return this.repo.saveItem(orderId, sku)
  }
}
