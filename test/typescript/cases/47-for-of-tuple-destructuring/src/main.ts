// `for (const [, v] of pairs)` where pairs is a TUPLE ARRAY. Plain array iteration
// already resolved, which is why this read as a for-of problem rather than a tuple one:
// the element of `[string, Val][]` is a TUPLE, and a tuple is structural -- it has no
// type entity for the element rule to return -- so every name destructured out of one
// was untyped.
export class Val { use(): void {} }

export function use(pairs: [string, Val][], vals: Val[]): void {
  for (const v of vals) { v.use(); }        // control: a plain array element, already worked
  for (const [, v] of pairs) { v.use(); }   // the case: destructured from a tuple element
}
