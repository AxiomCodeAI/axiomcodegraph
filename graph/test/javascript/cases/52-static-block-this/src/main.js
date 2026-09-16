// `this` inside a class static initialization block is the class constructor
// (#729): an inherited static called through it resolves, as the same call by
// name and the same call in a static method already do.
export class Base {
  static configure(o) { return 'configured:' + o.k; }
  static hook() { return 1; }
}

export class Child extends Base {
  static own() { return 2; }
  static {
    this.configure({ k: 'a' });
    Child.configure({ k: 'b' });
    this.own();
    const self = this;
    self.hook();
  }
  static viaMethod() { return this.configure({ k: 'c' }); }
}

// The control: `this` in an INSTANCE method is the instance, not the class, so
// an instance member resolves and a static through `this` does not.
export class Inst {
  static onlyStatic() { return 3; }
  run() { return this.helper(); }
  helper() { return 4; }
}
export function main() { Child.viaMethod(); new Inst().run(); }
