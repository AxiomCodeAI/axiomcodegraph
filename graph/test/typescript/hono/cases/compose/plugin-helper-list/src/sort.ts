export interface Sortable {
  id: string
  dependencies?: string[]
}

// dependency order (dependencies elided here): rebuilt into a new array at run time from the elements it is given
export function topoSort<T extends Sortable>(plugins: ReadonlyArray<T>): T[] {
  const result: T[] = []
  const seen = new Set<string>()
  function visit(p: T): void {
    if (seen.has(p.id)) return
    seen.add(p.id)
    result.push(p)
  }
  for (const p of plugins) visit(p)
  return result
}
