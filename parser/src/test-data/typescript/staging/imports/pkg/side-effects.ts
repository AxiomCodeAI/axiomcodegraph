// fixture: imports/pkg/side-effects (support module)
// nature: runtime-bearing
//
// A module with NO exports at all, imported purely for its top-level effect.
// This is the shape polyfills and framework registration modules take, and it
// is the one import form whose entire purpose is the edge itself.

declare const globalRegistry: { installed?: boolean } | undefined;

export {};

if (typeof globalRegistry !== "undefined") {
    globalRegistry.installed = true;
}
