// the runtime's own objects: none of these calls can land on the project's parse, forEach or resolve
export function readConfig(raw: string): unknown {
  return JSON.parse(raw)
}
export function listKeys(o: object): void {
  Object.keys(o).forEach((k) => console.log(k))
}
export function later(v: number): Promise<number> {
  return Promise.resolve(v).then((x) => x + 1)
}
// CONTROL: a receiver the engine cannot type may be a FrameParser: still a by-name caller
export function readAny(p: any, raw: string): unknown {
  return p.parse(raw)
}
export function drainAny(q: any): unknown {
  return q.resolve("x")
}
