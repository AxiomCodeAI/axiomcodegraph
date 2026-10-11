import { assign } from './utils'

// A callable API built as a FUNCTION OBJECT: the function is merged with its members by Object.assign,
// and the result is typed by a callable interface whose call signature has no body.
export interface Factory {
  (v: number): number
  box(v: number): number
}

export function track(v: number): number {
  return v + 1
}

function create(v: number): number {
  return track(v)
}

const members = {
  box(v: number): number {
    return v
  },
}

export const factory: Factory = assign(create, members)

export function trackDirect(v: number): number {
  return v * 2
}

// written with Object.assign itself and an inline function
export const direct = Object.assign((v: number) => trackDirect(v), { kind: 'direct' })

// control: the merge evaluates to its TARGET; a function passed as a later argument is not what a call of it runs
export function sourceOnly(v: number): number {
  return v
}

function target(v: number): number {
  return v
}

export const merged = Object.assign(target, { extra: sourceOnly }, sourceOnly)
