// Passing a type argument to a signature that declares no type parameters is an ERROR in
// TypeScript, so a non-generic overload is not a candidate at an explicitly-parameterised
// call. It was one, and being declared first it took every such call.
export class Item { ping(): void {} }

export class Factory {
  make(): Item;
  make<T>(seed?: T[]): Item;
  make(_seed?: unknown[]): Item { return new Item(); }
}

export function use(f: Factory): void {
  f.make();           // control: no type argument, the non-generic signature is right
  f.make<string>();   // one type argument, so only the generic signature applies
}
