// The slice of the standard library this case hands methods to. Declared here, as client code, so the
// client-only pass sees `forEach`, `map` and `bind` as what they are to the project: signatures with no body.
interface Array<T> {
  map<U>(fn: (v: T) => U, thisArg?: unknown): U[];
  forEach(fn: (v: T) => void, thisArg?: unknown): void;
}
interface Object {}
interface Boolean {}
interface Number {}
interface String {}
interface Function {
  bind(thisArg: unknown, ...args: unknown[]): any;
  call(thisArg: unknown, ...args: unknown[]): any;
}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
declare function setTimeout(cb: () => void, ms?: number): number;
