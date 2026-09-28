// CONTROL: inside the fixture program its own globals still resolve. `rows.map` must keep
// its edge to this program's `Array.map` (the one whose parameter is `each`). It also
// keeps the enclosing program's: a global declared under an ANCESTOR tsconfig stays
// visible below it, which is how a monorepo shares one `types/global.d.ts` — the IR does
// not say which files a nested program includes, so that direction stays a superset.
export class Row {
  key(): string { return "row"; }
}

export function keys(rows: Row[]): string[] {
  return rows.map((r) => r.key());
}
