// CROSS-PACKAGE RE-EXPORT, AND THE `typeof import(M)[K]` CONST.
//
// Two mechanisms, both taken from vitest/expect-type, both of which used to leave the
// call site with no answer at all:
//
//  1. @tt/probe's barrel reaches @tt/probe-core with `export ... from`, and never
//     imports it. Discovery that reads only IMPORT rows never stages probe-core, so
//     the re-export resolves to nothing and `probeOf` is not callable.
//
//  2. `globalProbe` is annotated `typeof import('@tt/probe')['probeOf']` — the exact
//     shape vitest's globals.d.ts uses to publish `expectTypeOf` into global scope.
//     Resolving it needs the INDEXED_ACCESS type reference to be read as a lookup of
//     an export name in a module, not as an opaque type.
import { probeOf, ProbeHandle, probeCount, probeLocal } from '@tt/probe';

export function callAcrossPackages<T>(subject: T): ProbeHandle<T> {
  return probeOf(subject);                    // -> probe-core.d.ts  probeOf
}

export function callStarAcrossPackages(items: readonly unknown[]): number {
  return probeCount(items);                   // -> probe-core.d.ts  probeCount
}

export function callHandleMethod(subject: string, other: string): boolean {
  return probeOf(subject).toBeAssignableTo(other); // -> probe-core.d.ts  ProbeHandle.toBeAssignableTo
}

// The control: declared in the barrel itself, so it answers with or without the
// cross-package hop.
export function callLocal(tag: string): string {
  return probeLocal(tag);                     // -> probe-index.d.ts  probeLocal
}

// The global-const shape. The annotation names no declaration directly — it looks up
// the export `probeOf` on the module `@tt/probe`, which itself re-exports it from
// probe-core. Both mechanisms have to work for this one site to resolve.
declare const globalProbe: typeof import('@tt/probe')['probeOf'];

export function callViaIndexedAccessConst(n: number): ProbeHandle<number> {
  return globalProbe(n);                      // -> probe-core.d.ts  probeOf
}
