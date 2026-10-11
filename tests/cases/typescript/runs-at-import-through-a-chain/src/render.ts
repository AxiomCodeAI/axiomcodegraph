import { isVoidTag } from './tags'
import { escape } from './escape'

// imports the table module, and is imported by `escape`, which it imports: a cycle
export function open(tag: string): string {
  return '<' + escape(tag) + '>'
}

export const voids = Object.keys(isVoidTag)
