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
