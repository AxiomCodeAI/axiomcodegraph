import outer = require("./legacy");

export function drive(): string {
  const n = new outer.inner.Node();
  // One hop and two hops through the namespace chain.
  return outer.pack() + outer.inner.deepPack() + n.visit();
}

// ── client -> library ────────────────────────────────────────────────────────
import vendor = require("../lib/legacy-lib");

export function useLibrary(): string {
  const n = new vendor.inner.Node();
  // An AMBIENT library namespace: no bodies at all, so every target is bodiless.
  return vendor.pack() + vendor.inner.deepPack() + n.visit();
}
