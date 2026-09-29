// A TEST FIXTURE's own standard library: a separate program (./tsconfig.json), so these
// globals belong to it alone. The parameter names differ from ../globals.d.ts on purpose,
// and `toString` takes a parameter, so the two `Array.map` and `Object.toString`
// declarations are told apart in the goldens.
interface Array<T> {
  map<U>(each: (item: T) => U): U[];
}
interface ReadonlyArray<T> {
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
