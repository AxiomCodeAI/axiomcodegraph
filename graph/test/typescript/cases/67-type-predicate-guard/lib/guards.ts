// A LIBRARY TYPE PREDICATE, in the shape the standard library writes one.
// `Array.isArray` is declared `isArray(arg: any): arg is any[]` — a plain `x is T`
// signature on an ambient declaration, reached from the client through an import exactly
// as `isSlots` is here. The engine read such signatures already
// (`predicate_subject_pos`, `predicate_target`) and nothing consumed them for a DIRECT
// guard, so `if (isArray(ro))` narrowed nothing. Issue #427.
//
// `mutate` exists ONLY on the narrowed interface. That is deliberate: it makes the
// guarded call unreachable without the narrowing, so this case cannot pass by accident
// on a name match the way a member shared by both interfaces could.
export interface ReadonlySlots<T> {
  peek(): T;
}
export interface Slots<T> {
  peek(): T;
  mutate(v: T): void;
}
export declare function isSlots<T>(v: ReadonlySlots<T>): v is Slots<T>;
