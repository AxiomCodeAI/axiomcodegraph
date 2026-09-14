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
// NO explicit `this` parameter on these. lib.es5.d.ts declares them with one, but the
// case oracle's edge label includes a `this` parameter in the signature while the engine
// (correctly) does not treat it as a parameter at all — so `this: Function` renders as
// `Function#apply(Function,any,any)` on one side and `Function#apply(any,any)` on the
// other, and every site scores as a disagreement the engine did not actually make.
interface Function {
  apply(thisArg: any, argArray?: any): any;
  call(thisArg: any, ...argArray: any[]): any;
  bind(thisArg: any, ...argArray: any[]): any;
  readonly name: string;
  toString(): string;
}

interface CallableFunction extends Function {
  // Simply typed on purpose. lib.es5.d.ts gives these precise generic signatures
  // (`this: (this: T, ...args: A) => R`), and this fixture does not need them: what it
  // tests is that TWO declarations of the same member names exist and that
  // `strictBindCallApply` picks between them, which the checker decides from the flag
  // and not from how well a signature fits. A function-typed parameter also renders
  // badly in the case oracle's edge labels — the label splits on the commas inside
  // `(this: T, ...args: A) => R` and emits `apply(args: A) =,T,T)`, which can never
  // match the engine's label, so every site scored as a disagreement.
  //
  // Arguments are optional and returns are `any` so every call form in the case source
  // typechecks. The two declarations stay distinguishable without help: an edge label
  // carries the OWNER, so `CallableFunction#call` and `Function#call` never collide, and
  // that owner is exactly what the flag decides.
  call(thisArg: any, arg0?: any, arg1?: any): any;
  apply(thisArg: any, args?: any): any;
  bind(thisArg: any, arg0?: any): any;
}


interface NewableFunction extends Function {}
