// THE 5.6 ITERATOR HELPERS, in the shape the standard library declares them — not
// invented. TypeScript 5.6 stopped declaring the collection accessors as
// `IterableIterator<T>` and gave each its own interface: `Map#values` returns
// `MapIterator<V>`, `Set#values` returns `SetIterator<T>`, `Array#entries` returns
// `ArrayIterator<[number, T]>`, and all of them extend `IteratorObject<T, …>` which
// extends the `Iterator<T, …>` the engine already knew.
//
// So the engine's container list went stale WITHOUT ANY RULE CHANGING: a `for…of` over a
// collection accessor stopped yielding an element the moment a project's standard library
// reached 5.6, and the symptom is a for-of gap rather than a renamed declaration. That is
// how issue #433's `map.values()` line survived three rounds of for-of work.
//
// WHY THESE NAMES AND NOT `Map` AND `Set`. A case's `lib/` is a client-authored second
// tree (see case 41): declaring `Map` here would shadow the global and the case would
// then be measuring its own stub. These carry the accessor SHAPE, which is what the rule
// keys on, and the standard library's own declarations are measured on the corpus.
// Each helper re-declares `[Symbol.iterator]()` as ITSELF, which is what the standard
// library writes and what makes it iterable — without it a `for…of` over one of these
// does not typecheck, and a case that does not typecheck is not a measurement.
export interface IteratorObject<T, TReturn, TNext> {
  next(): { value: T; done: boolean };
  [Symbol.iterator](): IteratorObject<T, TReturn, TNext>;
}
export interface MapIterator<T> extends IteratorObject<T, undefined, unknown> {
  [Symbol.iterator](): MapIterator<T>;
}
export interface SetIterator<T> extends IteratorObject<T, undefined, unknown> {
  [Symbol.iterator](): SetIterator<T>;
}
export interface ArrayIterator<T> extends IteratorObject<T, undefined, unknown> {
  [Symbol.iterator](): ArrayIterator<T>;
}

export interface Registry<K, V> {
  values(): MapIterator<V>;
  keys(): MapIterator<K>;
  entries(): MapIterator<[K, V]>;
}
export interface Bag<T> {
  values(): SetIterator<T>;
}
export interface Slots<T> {
  values(): ArrayIterator<T>;
}
