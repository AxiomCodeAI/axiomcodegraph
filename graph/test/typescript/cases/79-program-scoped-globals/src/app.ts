// Production code. `fixture/` is a SEPARATE program — its own tsconfig — that redeclares
// the standard library for a test. Its globals are not in scope here, so each call below
// has exactly one target, in ./globals.d.ts, and the callback passed in fixture/use.ts is
// not reached from `labels`.
export class Item {
  label(): string { return "item"; }
}

export function labels(items: Item[]): string[] {
  return items.map((i) => i.label());
}

export function describe(item: Item): string {
  return item.toString();
}
