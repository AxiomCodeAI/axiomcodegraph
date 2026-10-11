// A TEST FIXTURE's own standard library, in a SIBLING program: these globals belong to
// ./tsconfig.json alone. The parameter name differs from ../app/globals.d.ts on purpose,
// so the two `Array.map` declarations are told apart in the goldens, and this header is
// one line longer so neither `Array` spans the line of the other's `map`.
interface Array<T> {
  map<U>(each: (item: T) => U): U[];
}
interface Object { toString(radix?: number): string; }
interface Boolean {}
interface Number {}
interface String {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
