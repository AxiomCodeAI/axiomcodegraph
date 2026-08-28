// fixture: type-system/type-only/erasure-boundary
// nature: runtime-bearing
//
// Where erasure is decided. The same imported name can arrive by a runtime
// import or a type-only one, and the two differ in exactly one respect: the
// second leaves no trace in the emitted JavaScript.
//
// The distinction has to be made at EMIT time, not downstream: once a
// type-only import has been recorded as an import edge, the call graph has a
// phantom dependency in it.

// --- an entirely type-only import: erased in full ------------------
import type { Contract, Handler, Kind } from "./erased-exports";

// --- a type-only import of a CLASS: the class exists at runtime, but
//     this import of it does not ------------------------------------
import type { Marker } from "./erased-exports";

// --- a value import from the same module: this one survives -------
import { RUNTIME_VALUE, Marker as RuntimeMarker } from "./erased-exports";

// --- inline type specifiers mixed with value ones in one clause ---
import { type Kind as AlsoKind, RUNTIME_VALUE as ALSO_RUNTIME } from "./erased-exports";

// --- a type-only default import ----------------------------------
import type DefaultContract from "./default-type-export";

// --- type-only namespace import ----------------------------------
import type * as Contracts from "./erased-exports";

// --- erased positions: every use below disappears at emit --------

export function typeOnlyUses(
    contract: Contract,
    handler: Handler,
    kind: Kind,
    marker: Marker | undefined,
    fromDefault: DefaultContract | undefined,
): string {
    const alsoKind: AlsoKind = kind;
    const viaNamespace: Contracts.Contract = contract;

    handler(viaNamespace);

    return [contract.id, alsoKind, marker?.marked ?? false, fromDefault?.name ?? ""].join("|");
}

// --- retained positions: these survive ---------------------------

export function runtimeUses(): string {
    // a `new` of the class through its VALUE import
    const instance = new RuntimeMarker();
    return `${RUNTIME_VALUE}${ALSO_RUNTIME}${instance.marked}`;
}

// --- type-only re-exports, in both spellings --------------------

export type { Contract, Handler } from "./erased-exports";
export { type Kind } from "./erased-exports";

// --- a value re-export alongside them --------------------------

export { RUNTIME_VALUE } from "./erased-exports";
