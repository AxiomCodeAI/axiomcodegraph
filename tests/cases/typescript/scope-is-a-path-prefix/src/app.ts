import { seedRows } from './devtools/seed'

export function startApp(): number {
  return seedRows().length
}
