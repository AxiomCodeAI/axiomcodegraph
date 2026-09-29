// CONTROLS: a module that declares its own `Set` and `Promise`. They are not the built-ins,
// so `forEach` / `then` callbacks take their parameter from these classes' own signatures
// (a Key), never from the type argument (an Item).
export class Item {
  size = 1;
  display(): string {
    return 'i';
  }
}
export class Key {
  display(): string {
    return 'k';
  }
}
export class Set<T> {
  forEach(cb: (k: Key) => void): void {
    cb(new Key());
  }
}
export class Promise<T> {
  then(cb: (k: Key) => void): void {
    cb(new Key());
  }
}
export function ctlOwnSet(s: Set<Item>): void {
  s.forEach(k => k.display());
}
export function ctlOwnPromise(p: Promise<Item>): void {
  p.then(k => k.display());
}
// A union of two function types over DIFFERENT parameter types gives no contextual type
// (the compiler reports the parameter as implicitly `any`), so neither class is picked.
export function either(cb: ((i: Item) => void) | ((k: Key) => void)): void {}
export function ctlUnionOfFns(): void {
  // @ts-expect-error z is implicitly any
  either(z => z.display());
}
