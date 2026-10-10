// what the global set-up's code generator runs, once, before the whole run
export function renderSchema(name: string): string {
  return `schema ${name}`
}
