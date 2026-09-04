// ============================================================================
// The case's OWN standard library — the minimum the checker needs under `noLib`.
// ============================================================================
// WHY noLib. This mechanism's targets are declared in the REAL `lib.es5.d.ts`, and a
// case never has it: the case oracle only records a target inside the case's own files,
// and the engine is handed only `--library <this dir's IR>`. So with the real library
// neither side can name the target and the case measures nothing. Declaring `Function`
// and `CallableFunction` HERE puts them on both sides of the comparison.
//
// This is not a mock of the behaviour. The checker resolves `CallableFunction` by NAME
// from whatever is in scope and then applies `strictBindCallApply` itself, so these
// declarations exercise the real decision. Verified: the same two declarations answer
// CallableFunction under `strict: true` and Function under
// `strict: false, strictBindCallApply: false`.
//
// Everything other than Function/CallableFunction is here only because `noLib` removes
// it and the checker requires it. Keep this file minimal: an interface added here is a
// declaration the engine can resolve to, and an accidental one is an accidental answer.

interface Object { toString(): string; }
interface Boolean {}
interface Number {}
interface String { padStart(width: number): string; padEnd(width: number): string; trim(): string; }
interface Array<T> { length: number; }
interface ReadonlyArray<T> { length: number; }
interface IArguments {}
interface RegExp {}

// ── the two declarations the flag chooses between ───────────────────────────
// Mirrors lib.es5.d.ts: `Function` declares all three, and `CallableFunction extends
// Function` REDECLARES the same three with precise generic signatures. Both are in
// scope at every site; only the flag decides.
interface Function {
  apply(this: Function, thisArg: any, argArray?: any): any;
  call(this: Function, thisArg: any, ...argArray: any[]): any;
  bind(this: Function, thisArg: any, ...argArray: any[]): any;
  readonly name: string;
  toString(): string;
}

interface CallableFunction extends Function {
  call<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A): R;
  apply<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, args: A): R;
  // TWO bind overloads, mirroring lib.es5.d.ts, which declares one per partial-argument
  // count. Only the arity-0 and arity-1 forms are declared here because those are the
  // only ones the case uses; the real library goes to four. The overload SET matters to
  // this case: a site that partially applies must still land on CallableFunction rather
  // than falling back to Function's untyped `bind`, and with only the arity-0 form
  // declared it could not typecheck at all.
  bind<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T): (...args: A) => R;
  bind<T, A0, A extends any[], R>(this: (this: T, arg0: A0, ...args: A) => R, thisArg: T, arg0: A0): (...args: A) => R;
}

interface NewableFunction extends Function {}
