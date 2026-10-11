export function draftStep(x: number): number { return x + 1 }
export function patchStep(x: number): number { return x - 1 }
export function freezeStep(x: boolean): boolean { return !x }
export function plainStep(x: number): number { return x * 3 }

export class Engine {
  createDraft(x: number): number { return draftStep(x) }
  applyPatches(x: number): number { return patchStep(x) }
  setFreeze(x: boolean): boolean { return freezeStep(x) }
  plain(x: number): number { return plainStep(x) }
}

const engine = new Engine()

// the package's public functions are the default instance's methods, bound to it
export const createDraft = /* @__PURE__ */ engine.createDraft.bind(engine)
export const applyPatches = engine.applyPatches.bind(engine)
export let setFreeze = engine.setFreeze.bind(engine)
// read off the instance with no bind
export const plain = engine.plain

// a call in the same module, through the bound const
export function localUse(): number {
  return createDraft(1)
}
