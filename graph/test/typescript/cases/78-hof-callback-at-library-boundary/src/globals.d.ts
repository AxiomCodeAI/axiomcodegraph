// The slice of the standard library this case hands callbacks to. Declared here, as client code, so the
// client-only pass sees `map` and `forEach` as what they are to the project: signatures with no body.
interface Array<T> {
  map<U>(fn: (v: T) => U): U[];
  forEach(fn: (v: T) => void): void;
}
interface Object {}
interface Boolean {}
interface Number {}
interface String {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
