import type { Matcher, Rx, Bare } from "./text";
// Two blocks of one interface in one file: the compiler tries the second block first.
export interface Twice { go(m: Rx): 1; }
export interface Twice { go(m: Matcher): 2; }
// Control: the second block's parameter does not fit a Bare, so the first block stays.
export interface Once { keep(m: Bare): 1; }
export interface Once { keep(m: Matcher): 2; }

export function run(t: Twice, o: Once, r: Rx, b: Bare): void {
  t.go(r);
  o.keep(b);
}
