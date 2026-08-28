// fixture: type-system/structural/collision-support (support module)
// nature: runtime-bearing
//
// Exists so that name-collisions.ts can hold a type named `Row` that is
// imported AND a distinct type named `Row` that is local, distinguished only
// by an import alias.

export interface Row {
    readonly id: string;
}

export function makeRow(id: string): Row {
    return { id };
}
