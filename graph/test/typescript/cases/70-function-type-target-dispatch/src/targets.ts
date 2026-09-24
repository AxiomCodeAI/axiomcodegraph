// A FUNCTION TYPED BY WHERE IT IS WRITTEN (the Java lambda rule). A call through a function type reaches
// every function written where a value of that type is expected — a typed const, a returned function —
// whatever the value is stored in afterwards: an array read by index, iterated, or mapped over, or a value
// typed only by an `as` cast. Each call below resolves to CB's call signature, and impl1 and the arrow
// makeCb returns are its dispatch candidates.
export type CB = (n: number) => string

export const impl1: CB = (n) => 'one' + n
export function makeCb(): CB {
  return (n) => 'two' + n
}

export function viaAnnotatedParam(list: CB[]): string[] {
  return list.map((c) => c(1))
}

export function viaAsCast(x: unknown): string[] {
  const list = x as CB[]
  return list.map((c) => c(2))
}

export function viaForOf(list: CB[]): void {
  for (const c of list) c(3)
}

export function viaIndex(list: CB[]): string {
  return list[0](4)
}

export function viaGenericMap(list: number[]): CB[] {
  return list.map<CB>((k) => (n) => 'three' + n + k)
}
