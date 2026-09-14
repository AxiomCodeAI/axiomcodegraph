// THE CALLEE IS A VALUE, NOT A NAME. Every site here calls something that arrived as data:
// a parameter, a property, a bound method, an element of an array of functions. A call
// graph that resolves callees by looking up a name has nothing to look up.
import { Alpha, Beta, Gamma, Chainable } from '@f/shapes';

export function makeTag(): string {
  return 'made';
}

// A FUNCTION-TYPED PARAMETER. What can run here is whatever is passed, and both callers
// below are in this file.
export function invoke(fn: () => string): string {
  return fn();
}
export function invokeLocal(): string {
  return invoke(makeTag);                      // the argument is a local function
}
export function invokeArrow(): string {
  return invoke(() => 'inline');               // the argument is an arrow literal
}

// A METHOD stored in a variable and then called. The declaration is Alpha.tag; nothing at
// the call site says so.
export function detachedMethod(a: Alpha): string {
  const f = a.tag.bind(a);
  return f();
}

// A method reference passed straight to a library higher-order function.
export function methodReference(items: Alpha[]): string[] {
  return items.map((a) => a.tag());
}

// A FUNCTION RETURNING A FUNCTION, called immediately. Two call sites on one line, and
// the second one's callee is the first one's return type.
export function makeCounter(): () => number {
  let n = 0;
  return () => ++n;
}
export function doubleCall(): number {
  return makeCounter()();
}

// AN IIFE: the callee is a function expression with no name at all.
export const immediate: string = (() => new Gamma().tag())();

// A METHOD ON AN OBJECT LITERAL — a declaration with no class and no interface.
const ops = {
  run(input: string): string {
    return input;
  },
  nested: {
    deeper(input: string): string {
      return input;
    },
  },
};
export function objectLiteralCall(): string {
  return ops.run('x') + ops.nested.deeper('y');
}

// OPTIONAL CALL and OPTIONAL MEMBER ACCESS. `?.` short-circuits, so the call may not
// happen — but the declaration it would reach is unambiguous, and that is what a call
// graph must name.
export function optionalChain(a: Alpha | undefined): string | undefined {
  return a?.tag();
}
export function optionalCallee(fn: (() => string) | undefined): string | undefined {
  return fn?.();
}
export function nonNullAssertion(a: Alpha | null): string {
  return a!.tag();
}

// POLYMORPHIC `this`: `self()` and `step()` both return the RECEIVER's type, so a chain
// of them stays exact instead of widening to the declaring class.
export function fluentChain(c: Chainable): string {
  return c.self().step().step().done();
}

// A cast that CHANGES the answer. The compiler resolves `tag` on Gamma here, and an
// engine that keeps the declared type of `a` reaches Alpha.tag instead.
export function viaCast(a: Alpha): string {
  return (a as Gamma).tag();                   // Gamma.tag
}

// An array of functions, indexed. The callee is an element, and the element type is the
// only thing that names a signature.
const handlers: Array<(b: Beta) => number> = [(b) => b.only_beta()];
export function fromFunctionArray(b: Beta): number {
  return handlers[0](b);
}
