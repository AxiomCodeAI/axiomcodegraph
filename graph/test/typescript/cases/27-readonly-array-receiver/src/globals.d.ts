// The case's OWN standard library, for the reason 21 gives: the targets have to be
// declared HERE or neither side of the comparison can name them.
//
// ReadonlyArray and Array declare THE SAME MEMBER NAMES on purpose. That is the whole
// case: the two are distinct declarations, both in scope at every site, and which one a
// site names is decided by whether the receiver was annotated `readonly T[]` or `T[]`.
// If they declared different members the case could not tell a right answer from a
// lucky one.
interface ReadonlyArray<T> {
  slice(start?: number, end?: number): T[];
  every(pred: (v: T) => boolean): boolean;
  join(sep?: string): string;
}

interface Array<T> {
  slice(start?: number, end?: number): T[];
  every(pred: (v: T) => boolean): boolean;
  join(sep?: string): string;
  push(v: T): number;
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
