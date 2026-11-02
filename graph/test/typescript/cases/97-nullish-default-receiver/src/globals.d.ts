// The case's own standard library under `noLib`: a Map whose `get` may return
// undefined, and an Array to default to.
interface Object {}
interface Boolean {}
interface Number {}
interface String { trim(): string; }
interface Array<T> { length: number; push(...items: T[]): number; }
interface ReadonlyArray<T> { length: number; }
interface Map<K, V> { get(key: K): V | undefined; set(key: K, value: V): this; }
interface MapConstructor { new <K, V>(): Map<K, V>; }
declare var Map: MapConstructor;
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}
