import { createDraft, plain } from "./engine"
import { createDraft as otherDraft } from "./other"
import * as api from "./engine"

export function draftIt(): number {
  return createDraft(2)
}
export function patchIt(): number {
  return api.applyPatches(3)
}
export function plainIt(): number {
  return plain(4)
}
// CONTROL: the same exported name from another module runs that module's method, not this one's
export function otherIt(): number {
  return otherDraft(6)
}
