// fixture: type-system/merging/three-files/registry-http
// nature: type-only
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
