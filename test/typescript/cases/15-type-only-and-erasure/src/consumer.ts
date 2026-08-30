// A type-only import contributes NO runtime binding. If the engine treats
// `import type` as a value import, this case produces edges it should not.
import type { Spec, Alias } from "./types";
import { Impl } from "./types";

export function drive(s: Spec, a: Alias): string {
  const i = new Impl();
  // Two interface-typed receivers (Spec and its alias) plus one concrete.
  return String(s.check()) + String(a.check()) + String(i.check());
}

// ── client -> library ────────────────────────────────────────────────────────
import type { Contract } from "../lib/api";
import { Verifier } from "../lib/api";

export function useLibrary(c: Contract): string {
  // A TYPE-ONLY library import must contribute no runtime edge; the value import
  // beside it must.
  return String(c.verify()) + String(new Verifier().verify());
}
