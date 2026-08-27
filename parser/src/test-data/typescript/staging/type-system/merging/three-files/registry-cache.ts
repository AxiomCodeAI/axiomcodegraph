// fixture: type-system/merging/three-files/registry-cache
// nature: runtime-bearing
//
// Nature note: the merged `namespace Plugins` exports CONST members, so each
// of these files emits an IIFE and is runtime-bearing. Only the `interface`
// half of the merge is erased. A namespace's nature follows its contents, so
// a file mixing both is runtime-bearing.
//
// Declaration three of three. The merged `Registry` now carries members from
// three distinct files, and `Plugins` carries three member sets.

interface Registry {
    readonly cache: {
        readonly maxEntries: number;
    };
}

namespace Plugins {
    export interface CacheOptions {
        readonly ttlSeconds: number;
    }
    export const cacheId = "cache";
}
