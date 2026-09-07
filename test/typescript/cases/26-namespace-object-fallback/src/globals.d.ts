// The case's OWN standard library, for the reason 21 gives: under `noLib` the target
// has to be declared HERE or neither side of the comparison can name it. `Object` is
// the whole point of this case — the fallback under test resolves to its members.
interface Object { toString(): string; }
interface Boolean {}
interface Number {}
interface String {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface Array<T> { length: number; }
interface ReadonlyArray<T> { length: number; }
interface IArguments {}
interface RegExp {}
