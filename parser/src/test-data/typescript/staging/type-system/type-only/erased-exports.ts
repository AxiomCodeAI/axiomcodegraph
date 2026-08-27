// fixture: type-system/type-only/erased-exports (support module)
// nature: type-only
//
// A module whose every export is erased. Imported by erasure-boundary.ts to
// show that an import edge to it carries no runtime dependency at all.

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
