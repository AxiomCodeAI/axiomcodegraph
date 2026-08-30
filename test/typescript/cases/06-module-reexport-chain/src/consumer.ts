import { Engine, start } from "./deep";

export function drive(): string {
  // Engine came through core -> barrel -> deep; start is an ALIAS of boot.
  const e = new Engine();
  return e.start() + start();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Session, dial } from "../lib/index";

export function useLibrary(): string {
  const s = new Session();
  // Through the library's own barrel AND its alias — two hops inside the library IR.
  return s.open() + dial();
}
