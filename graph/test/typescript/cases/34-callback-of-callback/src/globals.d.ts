// The case's OWN standard library, for the reason 21 gives: under `noLib` the target has
// to be declared HERE or neither side of the comparison can name it.
//
// `Maker` reproduces PromiseConstructor's shape exactly — a construct signature whose
// parameter 0 is an EXECUTOR, itself a function whose own parameters are functions. That
// nesting is the whole case, and it is what the real `new Promise((resolve, reject) => …)`
// is an instance of.
interface Made<T> {
  unwrap(): T;
}
interface MakerConstructor {
  new <T>(executor: (resolve: (value: T) => void, reject: (reason: string) => void) => void): Made<T>;
}
declare const Maker: MakerConstructor;

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
