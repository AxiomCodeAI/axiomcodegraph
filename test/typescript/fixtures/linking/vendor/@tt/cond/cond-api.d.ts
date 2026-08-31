// A CONDITIONAL RETURN TYPE. The engine cannot evaluate `K extends string ? A : B`
// — that is type-level computation — so before the branch descent existed the whole
// reference resolved to nothing and every call on the result was unanswerable.
//
// Both branches declare `shared`, so the honest answer is a two-candidate SET rather
// than one target. `alphaOnly` and `betaOnly` exist to prove the descent reaches the
// branches themselves and not merely some common supertype.
export interface CondAlpha {
  shared(tag: string): string;
  alphaOnly(): number;
}
export interface CondBeta {
  shared(tag: string): string;
  betaOnly(): boolean;
}
export declare function condPick<K>(key: K): K extends string ? CondAlpha : CondBeta;

// The CHECK and EXTENDS halves must never be descended into: `Marker` is written in
// the check position only. If it ever shows up as a receiver type, the descent is
// reading all four children instead of the two branches — the exact failure Java's
// mandatory depth filter in type-var-bound.dl exists to prevent.
export interface Marker { markerOnly(): void }
export declare function condGuarded<K>(key: K): K extends Marker ? CondAlpha : CondBeta;

// A FUNCTION TYPE used as a member's type. The signature is declared inside a TYPE,
// so its row carries no return reference at all (7,182 of 7,182 such rows across the
// staged corpus) — the return has to be read off the FUNCTION_TYPE reference's
// METHOD_RETURN child instead. Without that, `make(...)` resolves and the chain then
// stops dead because the call has no result type.
export interface FnHandle {
  finish(label: string): string;
}
export interface FnRegistry {
  make: (name: string) => FnHandle;
  build: (name: string) => FnHandle[];
}
export declare const fnRegistry: FnRegistry;

// A const whose TYPE is a `typeof` query over a QUALIFIED name — how a library
// re-exports a native static under its own name. The parser emits a TYPE_QUERY whose
// `name` is the member and whose completeTypeName is the whole text, with no children,
// so the qualifier has to be cut out of the string. Measured across corpus production
// code, 8 declarations of this shape accounted for 182 unresolved call sites.
export declare const isArrayAlias: typeof Array.isArray;
export declare const assignAlias: typeof Object.assign;
