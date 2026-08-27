// fixture: type-system/merging/three-files/registry-core
// nature: type-only
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
