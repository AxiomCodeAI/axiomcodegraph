// A MERGED declaration: an interface and a function under one exported name (#645).
export interface $constructor<T> { new (def: T): object; }
export /*@__NO_SIDE_EFFECTS__*/ function $constructor<T>(name: string, init: (inst: object) => void): $constructor<T> { init({}); return null as never; }
export function helper(): number { return 1; }
export function plain(): number { return 2; }
export interface OnlyType { x: number }
