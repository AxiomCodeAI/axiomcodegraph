import { Bag } from "../lib/collection";

// A subclass of a VALUE-declared base that declares NO constructor of its own. The
// inherited-constructor walk cannot help: `Bag`'s INSTANCE interface has no construct
// signature -- it lives on `BagConstructor` -- so the ancestor walk finds nothing to
// inherit and the class looks constructor-less.
export class Bucket<K, V> extends Bag<K, V[]> {
  add(key: K, item: V): void {}
}

// Control one: an ordinary client base. The implicit constructor already worked here.
export class Base { constructor(public n: number = 0) {} run(): void {} }
export class Derived extends Base {}

// Control two: the same value-declared base, but with an EXPLICIT constructor. Its
// `super()` already resolved, and the guard must keep `new` on it exact rather than
// adding the base's constructor alongside its own.
export class Explicit<K, V> extends Bag<K, V[]> {
  constructor() { super(); }
}

export function use(): void {
  new Bucket<string, number>();
  new Derived();
  new Explicit<string, number>();
}
