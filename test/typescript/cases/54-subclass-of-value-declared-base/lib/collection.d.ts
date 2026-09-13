// The JAVASCRIPT CONSTRUCTOR PATTERN, written the way the standard library writes it:
// the instance interface declares NO construct signature, a separate `*Constructor`
// interface holds it, and a `declare const` of that type is the value `new` actually
// names. Reproduced structurally rather than copied from lib.es2015.collection.d.ts --
// what this case turns on is WHERE the constructor lives, not the exact signatures.
//
// ONE construct signature on purpose. The real `MapConstructor` declares two, and which
// of them a `super()` selects is an overload question with its own answer; carrying it
// here would make this case fail for a reason that has nothing to do with construction
// through a value-declared base.
export interface Bag<K, V> {
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): this;
}

export interface BagConstructor {
  new <K, V>(): Bag<K, V>;
}

export declare const Bag: BagConstructor;
