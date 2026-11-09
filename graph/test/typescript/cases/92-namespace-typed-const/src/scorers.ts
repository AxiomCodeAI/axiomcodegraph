export type Scorer = (input: string) => number;
export function makeScorer(base: number): Scorer {
  const fn: Scorer = (input) => input.length + base;
  return fn;
}
// a function-typed const whose value is a factory's result: no literal to read
export const score: Scorer = makeScorer(1);
export const scoreArrow: Scorer = (input) => input.length;
export function plain(input: string): number { return input.length; }
