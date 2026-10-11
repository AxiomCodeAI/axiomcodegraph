export function otherStep(x: number): number { return x * 5 }

export class Other {
  createDraft(x: number): number { return otherStep(x) }
}
const other = new Other()
// the same exported name, bound to a different instance's method
export const createDraft = other.createDraft.bind(other)
