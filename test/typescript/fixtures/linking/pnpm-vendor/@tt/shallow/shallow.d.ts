// Hoisted to the top level, and it re-exports a package that is NOT. Discovery names
// @tt/deep correctly off this re-export; resolving it requires walking up from THIS
// package's real directory inside the store, not from the project root.
export { deepCall, deepStatic, DeepStatic } from '@tt/deep';
export declare function shallowLocal(tag: string): string;
