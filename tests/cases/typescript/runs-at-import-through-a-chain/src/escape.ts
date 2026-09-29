import { open } from './render'

export function escape(s: string): string {
  return s.replace(/</g, '&lt;')
}

export function wrap(s: string): string {
  return open('b') + s
}
