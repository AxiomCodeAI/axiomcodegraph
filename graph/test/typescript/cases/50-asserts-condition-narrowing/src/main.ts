// `assert(canCall(r), "no")` — a BARE `asserts check` whose subject is a call to a type
// predicate. Two things distinguish it from `asserts r is Caller`: the assertion carries
// no `is T` of its own, so it asserts nothing by itself, and its subject is a CALL rather
// than a reference to a parameter. What narrows `r` is the predicate the subject calls.
//
// This was a WRONG answer rather than a missing one: the guarded call committed a single
// edge to the UNNARROWED declaration. The `asserts r is Caller` spelling below already
// produced a set containing the compiler's answer, which is why it read as a one-off.
export interface Runner { call?: (s: string) => string }
export interface Caller extends Runner { call: (s: string) => string }

export function canCall(r: Runner | null): r is Caller { return !!r && typeof r.call === "function"; }
export function assert(check: unknown, message: string): asserts check { if (!check) throw new Error(message); }
export function assertCaller(r: Runner | null): asserts r is Caller { if (!canCall(r)) throw new Error("no"); }

export function viaCondition(r: Runner | null): string { assert(canCall(r), "no"); return r.call("x"); }
export function viaPredicate(r: Runner | null): string { assertCaller(r); return r.call("y"); }
