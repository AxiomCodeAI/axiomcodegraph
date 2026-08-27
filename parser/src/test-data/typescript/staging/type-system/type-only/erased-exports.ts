// fixture: type-system/type-only/erased-exports (support module)
// nature: runtime-bearing
//
// Deliberately MIXED: erased exports (interface, type alias) alongside real
// ones (a class, a const). That mixture is the point -- erasure-boundary.ts
// imports this same module twice, once with `import type` and once without, so
// the two import edges can be told apart.
//
// The file itself is runtime-bearing: it emits the class and the const. What is
// erased is the *importing* side of a type-only import, not this module.

export interface Contract {
    readonly id: string;
}

export type Handler = (contract: Contract) => void;

export type Kind = "a" | "b";

// a class used ONLY as a type by consumers -- it does emit here, but an
// `import type` of it does not create a runtime edge at the import site
export class Marker {
    readonly marked = true;
}

export const RUNTIME_VALUE = "emitted";
