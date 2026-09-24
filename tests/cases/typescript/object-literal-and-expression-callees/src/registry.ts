// A CALL THROUGH A STATIC FUNCTION-TYPED FIELD. `Registry.format(n)` names a static field whose type is a function
// type; the call resolves to that type's call signature, and the function the field holds is what runs.
export type Format = (n: number) => string

export function money(n: number): string {
  return '$' + n
}

export class Registry {
  static format: Format = money
}

export function price(n: number): string {
  return Registry.format(n)
}
