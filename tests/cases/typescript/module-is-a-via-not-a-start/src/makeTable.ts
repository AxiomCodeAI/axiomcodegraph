export function makeTable(spec: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of spec.split(',')) out[k] = true
  return out
}
