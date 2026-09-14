// fixture: imports/pkg/index (support module — the barrel)
// nature: runtime-bearing
//
// A barrel file, the commonest re-export shape in real TypeScript packages.
// It exercises every `export ... from` form, including the `export type`
// spelling that `isolatedModules` REQUIRES for type-only re-exports -- a
// distinction Java's import model has no room for.

// re-export named bindings
export { hasRole, formatUser, DEFAULT_ROLE } from "./util";

// re-export with renaming
export { Clock as SystemClock } from "./util";

// re-export a default as a named binding
export { default as createId } from "./util";

// type-only re-export (required under isolatedModules)
export type { User, Session, Role, UserId } from "./models";

// star re-export
export * from "./side-effects";

// namespaced star re-export
export * as models from "./models";
