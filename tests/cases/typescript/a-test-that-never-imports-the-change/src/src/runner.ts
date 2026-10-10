import type { Handler } from './types'

export function run(h: Handler, x: number): number {
  return h(x)
}
