// The library half: a generic class the client instantiates with its OWN type
// argument, and a library type the client writes as a type argument to its own
// generic. Both directions of the boundary, because the binding is positional and
// nothing about it should depend on which side declares what.
export class LibOp {
  fire(x: number): number {
    return x - 1;
  }
}

export class LibBox<T> {
  private v!: T;
  constructor() {}
  get(): T {
    return this.v;
  }
}
