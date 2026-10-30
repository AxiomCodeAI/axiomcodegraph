// census: this_arrow (SPEC R20; call-chain break class 4, "this inside a nested arrow")
// `this` inside an arrow function nested in a method, at depth 1, 2 and 3, and in an arrow inside a STATIC method
// (where `this` is the class), is the method's `this`: the calls reach the class's own members.
export class Resp {
  private static norm(p: string[]) {
    return p.join('.')
  }
  static fail(issues: Array<{ path: string[] }>) {
    return issues.map((i) => ({ path: this.norm(i.path) }))
  }
}

export class Catalog {
  items: string[]
  constructor() {
    this.items = ['a', 'b']
  }
  price(item: string) {
    return item.length
  }
  tax(n: number) {
    return n / 10
  }
  round(n: number) {
    return Math.round(n)
  }
  // depth 1
  prices() {
    return this.items.map((i) => this.price(i))
  }
  // depth 2
  taxes() {
    return this.items.map((i) => [i].map((j) => this.tax(this.price(j))))
  }
  // depth 3
  rounded() {
    return this.items.map((i) => [i].map((j) => [j].map((k) => this.round(this.tax(this.price(k))))))
  }
  // an arrow stored in a local, then called
  async later() {
    const run = async () => {
      const inner = () => this.price('late')
      return inner()
    }
    return run()
  }
}
