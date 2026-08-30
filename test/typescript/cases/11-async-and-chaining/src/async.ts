// await unwraps the promise, and the awaited value's members must resolve.
// Chained calls share a start position, which is why call sites are keyed on
// the FULL span and not on the start alone.

export class Row {
  id(): string {
    return "1";
  }
}

export class Repo {
  async find(): Promise<Row> {
    return new Row();
  }
  sync(): Row {
    return new Row();
  }
  self(): Repo {
    return this;
  }
}

export async function drive(): Promise<string> {
  const r = new Repo();
  const row = await r.find();
  // Three calls on ONE line, each its own site.
  return row.id() + r.self().self().sync().id();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Store } from "../lib/store";

export async function useLibrary(): Promise<string> {
  const s = new Store();
  // await across the boundary, then a member of the awaited LIBRARY type.
  const rec = await s.load();
  return rec.key() + s.self().self().load.name;
}
