export class Cell<T> {
  constructor(private readonly v: T) {}
  value(): T {
    return this.v;
  }
}
export function unwrap<T>(c: Cell<T>): T {
  return c.value();
}
