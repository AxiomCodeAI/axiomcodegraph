// A module with a default AND a named component. A loader that projects the named one
// out of the module (`.then(m => m.NamedHeavy)`) must not land on the default.
export function heavyWork(): number {
  return 1;
}
export function namedWork(): number {
  return 2;
}

export default function Heavy(): string {
  return String(heavyWork());
}

export function NamedHeavy(): string {
  return String(namedWork());
}
