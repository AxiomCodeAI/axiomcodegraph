export interface Module { name: string; init(): number }
export function coreInit(): number { return 1 }
export function reactInit(): number { return 2 }
export function auditInit(): number { return 3 }

export const coreModule = (): Module => ({ name: "core", init() { return coreInit() } })
export const reactModule = (): Module => ({ name: "react", init() { return reactInit() } })

// a list typed by a type parameter constrained to an array, or to a non-empty tuple, then iterated
export function buildAll<Ms extends Module[]>(modules: Ms): number[] {
  return modules.map((m) => m.init())
}
export function buildCreate<Ms extends [Module, ...Module[]]>(...modules: Ms): number[] {
  return modules.map((m) => m.init())
}
export function each<Ms extends readonly Module[]>(modules: Ms): void {
  modules.forEach((m) => { m.init() })
}

export interface Auditor { audit(): number }
export const auditor = (): Auditor => ({ audit() { return auditInit() } })
// CONTROL: an unconstrained type variable has no element type: the call on its element stays unresolved
export function loose<Ms extends unknown[]>(xs: Ms): unknown[] {
  return xs.map((x) => (x as any).audit())
}

export function loopAll<Ms extends Module[]>(modules: Ms): number {
  let n = 0
  for (const m of modules) n += m.init()
  return n
}
