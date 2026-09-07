// `readonly T[]` is ReadonlyArray<T>, not Array<T>. Both declare these members, so a
// site that names Array's declaration is a committed WRONG answer rather than a
// harmless imprecision — and it is the ordinary shape of a function that promises not
// to mutate its input.

export function useSlice(data: readonly string[]): string[] {
  return data.slice(0, 2);
}

export function useEvery(fns: readonly ((v: number) => boolean)[]): boolean {
  return fns.every((f) => f(1));
}

export function useJoin(data: readonly number[]): string {
  return data.join("-");
}

// THE CONTROL. A mutable array receiver must still name Array's declaration. A fix that
// routed every array receiver to ReadonlyArray would pass the three above and break
// this one.
export function mutableSlice(data: string[]): string[] {
  return data.slice(0, 2);
}

export function mutablePush(data: string[]): number {
  // Declared ONLY on Array, so it also pins that the mutable path reaches Array at all.
  return data.push("x");
}
