// The case's own standard library under `noLib`. Number, BigInt and String all declare
// `toString`, so a receiver typed as the wrong one of the three names a different
// declaration rather than the same one by luck.
interface Object { valueOf(): Object; }
interface Boolean {}
interface Number { toFixed(digits?: number): string; toString(radix?: number): string; }
interface BigInt { toString(radix?: number): string; }
interface String { trim(): string; toString(): string; }
interface Array<T> { length: number; }
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
