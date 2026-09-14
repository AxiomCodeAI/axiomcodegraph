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
