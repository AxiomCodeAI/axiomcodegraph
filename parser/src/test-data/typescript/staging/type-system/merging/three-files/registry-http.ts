// fixture: type-system/merging/three-files/registry-http
// nature: runtime-bearing
//
// Nature note: the merged `namespace Plugins` exports CONST members, so each
// of these files emits an IIFE and is runtime-bearing. Only the `interface`
// half of the merge is erased. A namespace's nature follows its contents, so
// a file mixing both is runtime-bearing.
//
// Declaration two of three. Adds an `http` member to `Registry` and a second
// member set to `namespace Plugins`, merging with registry-core.ts.

interface Registry {
    readonly http: {
        readonly baseUrl: string;
        readonly timeoutMs: number;
    };
}

namespace Plugins {
    export interface HttpOptions {
        readonly retries: number;
    }
    export const httpId = "http";
}
