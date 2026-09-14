// fixture: type-system/merging/three-files/consumer
// nature: runtime-bearing
//
// Reads members contributed by all three declaration sites, for both the
// merged interface and the merged namespace.

function readRegistry(registry: Registry): string {
    return [
        registry.core.version, // registry-core.ts
        registry.http.baseUrl, // registry-http.ts
        String(registry.http.timeoutMs), // registry-http.ts
        String(registry.cache.maxEntries), // registry-cache.ts
    ].join("|");
}

function readPlugins(
    manifest: Plugins.Manifest, // registry-core.ts
    http: Plugins.HttpOptions, // registry-http.ts
    cache: Plugins.CacheOptions, // registry-cache.ts
): string {
    return [
        manifest.id,
        String(http.retries),
        String(cache.ttlSeconds),
        Plugins.coreId,
        Plugins.httpId,
        Plugins.cacheId,
    ].join("|");
}

const registry: Registry = {
    core: { version: "1" },
    http: { baseUrl: "/", timeoutMs: 10 },
    cache: { maxEntries: 5 },
};

void readRegistry(registry);
void readPlugins({ id: "a" }, { retries: 1 }, { ttlSeconds: 2 });
