// A NON-FLAT (pnpm) INSTALL, where a transitive dependency is not hoisted.
//
// @tt/shallow is at the top level of node_modules. @tt/deep is NOT — it exists only
// inside the store, reachable from @tt/shallow's own directory. Discovery names it
// correctly off the re-export, but resolving it requires walking up from the
// DEPENDENT's real path (the store), which is what node itself does. A resolver that
// only looks at the project's node_modules roots finds nothing and stages nothing.
import { deepCall, deepStatic, shallowLocal } from '@tt/shallow';

export function callAcrossStore(tag: string): string {
  return deepCall(tag);                  // -> deep.d.ts  deepCall
}

// A const whose TYPE carries the call signature, not a function declaration. Needs
// the callable-variable rule rather than the function-binding one.
export function callCallableConst(n: number): string {
  return deepStatic(n);                  // -> deep.d.ts  DeepStatic call signature
}

export function callMemberOnCallable(name: string): void {
  deepStatic.extend(name);               // -> deep.d.ts  DeepStatic.extend
}

// The control: declared in the hoisted package itself, so it resolves even when the
// store walk is broken.
export function callHoisted(tag: string): string {
  return shallowLocal(tag);              // -> shallow.d.ts  shallowLocal
}
