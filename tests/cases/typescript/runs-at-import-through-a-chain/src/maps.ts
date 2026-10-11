// A helper CALLED AT MODULE LEVEL to build a lookup table.
export function makeMap(list: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of list.split(',')) out[k] = true
  return out
}
