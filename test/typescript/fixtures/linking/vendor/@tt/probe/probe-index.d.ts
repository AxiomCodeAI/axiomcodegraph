// A BARREL THAT RE-EXPORTS ACROSS A PACKAGE BOUNDARY AND NEVER IMPORTS.
//
// This is the shape that made vitest's `expectTypeOf` unreachable: the barrel says
// `export { ... } from 'another-package'` and contains no `import` of it at all. A
// staging pass that discovers dependencies by reading IMPORT rows therefore never
// stages @tt/probe-core, the re-export's resolved source module stays EMPTY, and the
// barrel exports nothing that can be called.
export { probeOf, ProbeHandle } from '@tt/probe-core';
export * from '@tt/probe-core';

// Declared locally, so it resolves even when the cross-package hop is broken. It is
// the control: if this one answers and the re-exported ones do not, the failure is
// the package boundary and not the barrel.
export declare function probeLocal(tag: string): string;
