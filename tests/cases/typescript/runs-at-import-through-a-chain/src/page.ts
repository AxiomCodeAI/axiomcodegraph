import { wrap } from './escape'

// two imports away from the table module, and calls nothing in it
export function page(s: string): string {
  return wrap(s)
}
