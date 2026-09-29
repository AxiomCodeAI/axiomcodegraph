// CONTROL: `Bag` lives in this program, has the fixture `Array`'s one member and is
// constructed, so it stays a structural conformer of this program's `Array`: `rows.map`
// keeps its dispatch to `Bag.map`. Only the other program's `Pipeline` drops out.
export class Row {
  key(): string { return "row"; }
}

export class Bag<T> {
  map<U>(each: (item: T) => U): U[] { return []; }
}

export function keys(rows: Row[]): string[] {
  return rows.map((r) => r.key());
}

export const bag = new Bag<Row>();
