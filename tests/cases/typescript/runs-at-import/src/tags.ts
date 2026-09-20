import { makeMap } from './maps'

// the module body runs this while being imported
export const isVoidTag = makeMap('br,hr,img')

export function check(tag: string): boolean {
  return isVoidTag[tag] === true
}
