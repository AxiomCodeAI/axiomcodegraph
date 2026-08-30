// A barrel: named re-export, star re-export, aliased re-export, and a TYPE-ONLY
// re-export that must NOT produce a runtime binding.
export { Engine } from "./core";
export { boot as start } from "./core";
export type { Options } from "./core";
