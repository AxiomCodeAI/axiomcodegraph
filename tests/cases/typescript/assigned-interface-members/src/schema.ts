// An object's "methods" are declared on an interface and implemented by ASSIGNING
// functions to them at run time; callers reach them through a parameter typed only by
// a declared generic function type.

export interface Internals {
  parse(x: number): number
  run(x: number): number
}
export interface Schema { readonly _i: Internals }

export type Parse = <T extends Schema>(schema: T, value: number) => number

// the implementations are assigned to the interface's method members
export function init(inst: Schema, checked: boolean): void {
  inst._i.parse = (x) => x + 1
  if (!checked) {
    inst._i.run = inst._i.parse
  } else {
    inst._i.run = (x) => inst._i.parse(x) * 2
  }
}

// `schema` is typed only by the declared function type Parse (generic, T extends Schema)
export const parse: Parse = (schema, value) => schema._i.run(value)

// control: an explicitly typed parameter
export function parseTyped(schema: Schema, value: number): number {
  return schema._i.run(value)
}
