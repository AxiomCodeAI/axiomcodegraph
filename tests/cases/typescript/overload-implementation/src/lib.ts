// An overloaded function: the compiler binds every call to one of the bodiless signatures, and the implementation
// below them is the only body that runs.
export function pick(x: number): number
export function pick(x: string): string
export function pick(x: any): any {
  return normalize(x)
}

export function normalize<T>(x: T): T {
  return x
}

export class Box {
  get(k: string): string
  get(k: number): number
  get(k: any): any {
    return k
  }
}
