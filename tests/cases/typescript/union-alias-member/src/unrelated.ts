import { Plain } from './state'

export function show(p: Plain): string {
  return typeof p === 'string' ? p : String(p.n)
}
