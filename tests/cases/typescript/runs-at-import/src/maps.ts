// A helper CALLED AT MODULE LEVEL to build a lookup table. Break it and importing any
// module whose top level calls it fails — and with it every module that imports those.
export function makeMap(list: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of list.split(',')) out[k] = true
  return out
}
