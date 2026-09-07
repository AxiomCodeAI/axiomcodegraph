import { text, plain } from "./helper";

// The namespace DECLARES `toString`, so Object's must not answer here. The member is
// a function value bound to a name, which the lookup does not yet find (#229) — so the
// honest verdict is no answer, and `Object#toString` is a committed WRONG one.
export function a(): string {
  return text.toString("x");
}

// Not an Object member at all, so nothing masks the same lookup gap: already unknown.
export function b(): string {
  return text.unique("x");
}

// THE CONTROL: no `toString` on this namespace, so Object's IS the right target.
export function c(): string {
  return plain.toString();
}
