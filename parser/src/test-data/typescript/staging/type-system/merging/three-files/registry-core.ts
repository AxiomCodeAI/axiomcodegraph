// fixture: type-system/merging/three-files/registry-core
// nature: runtime-bearing
//
// Nature note: the merged `namespace Plugins` exports CONST members, so each
// of these files emits an IIFE and is runtime-bearing. Only the `interface`
// half of the merge is erased. A namespace's nature follows its contents, so
// a file mixing both is runtime-bearing.
//
// Declaration merging across THREE files, the shape a plugin ecosystem takes:
// a core declares the base contract, and each plugin file widens the SAME
// interface and the SAME namespace. Nothing imports anything.
//
// Declaration one of three for both `Registry` and `namespace Plugins`.

interface Registry {
    readonly core: {
        readonly version: string;
    };
}

namespace Plugins {
    export interface Manifest {
        readonly id: string;
    }
    export const coreId = "core";
}
