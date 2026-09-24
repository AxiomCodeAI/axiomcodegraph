// AN INTERFACE MEMBER IMPLEMENTED BY AN OBJECT LITERAL. A factory returns `{ run, size() {…} }` typed as Pool, a
// const is declared Pool and initialised with a literal, and a literal is passed where a Pool is expected. There is
// no class, so no nominal or structural implementation of Pool.run exists; the literal's properties are what runs
// when `pool.run(…)` is called, and each must be a dispatch candidate of the member signature it implements.
export interface Pool {
  run(fn: () => number): number
  size(): number
}

export function createPool(): Pool {
  const run = (fn: () => number): number => fn()
  return { run, size() { return 1 } }
}

export const fixed: Pool = {
  run: (fn) => fn() + 1,
  size: () => 0,
}

export function usePool(pool: Pool): number {
  return pool.run(() => 2) + pool.size()
}

export function main(): number {
  return usePool(createPool()) + usePool(fixed) + usePool({ run: (fn) => fn() * 2, size: () => 3 })
}
