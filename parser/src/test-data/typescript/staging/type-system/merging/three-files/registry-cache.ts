// fixture: type-system/merging/three-files/registry-cache
// nature: type-only
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
