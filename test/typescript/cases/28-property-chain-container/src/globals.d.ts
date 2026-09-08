interface Array<T> {
  filter(pred: (v: T) => boolean): T[];
  map<U>(fn: (v: T) => U): U[];
}
interface ReadonlyArray<T> {
  filter(pred: (v: T) => boolean): T[];
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
