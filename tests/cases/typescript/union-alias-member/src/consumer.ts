import { AnyState, DraftState } from './state'

export function finalize(state: DraftState): string {
  return state.kind
}

export function maybe(state: AnyState): string {
  return state ? finalize(state) : ''
}
