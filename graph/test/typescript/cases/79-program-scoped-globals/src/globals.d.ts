// The PRODUCTION program's standard library, under `noLib` for the reason case 21 gives.
// Every name here is visible to every file this tsconfig governs, and to files below it.
interface Array<T> {
  map<U>(fn: (v: T) => U): U[];
}
interface ReadonlyArray<T> {
  map<U>(fn: (v: T) => U): U[];
}
interface Object { toString(): string; }
interface Boolean {}
interface Number {}
interface String {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
