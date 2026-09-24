import * as E from './make'

// a variable holding what a call returned
export function viaBlock(): number {
  const f = E.blockMake(1)
  return f(2)
}

export function viaConcise(): number {
  const g = E.conciseMake(1)
  return g(2)
}

// the callee is itself a call
export function immediately(): number {
  return E.conciseMake(1)(2)
}

// two levels of currying
export function twoLevels(): number {
  const h = E.curried(1)
  return h(2)(3)
}

// a type parameter named like the namespace import: in a value position `E` is still the namespace
export const shadowed = <E>(M: E.Monoid<E>): E => E.compact(M)
