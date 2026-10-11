// The PRODUCTION program's standard library (noLib, as case 21 explains). `Array.map` here
// and `Pipeline.map` below both take one callback.
interface Array<T> {
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
