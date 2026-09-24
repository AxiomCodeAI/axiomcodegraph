import { mergePath } from './utils'

export function request(base: string, path: string): string {
  return mergePath(base, path)
}
