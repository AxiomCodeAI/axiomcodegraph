// STAR RE-EXPORT, NAMESPACE RE-EXPORT, AND A RENAMING CHAIN.
//
// Nothing the client writes here appears in the file that declares it:
//   `alpha`   is re-exported by `export *`, which names no symbols at all
//   `tools.charlie` is reached through `export * as tools`
//   `topFn`   is `leafFn`, renamed twice on the way out
// A module graph that follows only named specifiers sees @tt/barrel as an EMPTY package.
import { alpha, Bravo, tools } from '@tt/barrel';
import { topFn, TopRelay } from '@tt/chain';

export function callAlpha(input: string): string {
  return alpha(input);                     // -> barrel-inner-a.d.ts  alpha
}

export function callBravo(times: number): string {
  return new Bravo().ring(times);          // -> barrel-inner-b.d.ts  Bravo.ring
}

export function callCharlie(n: number): number {
  return tools.charlie(n);                 // -> barrel-inner-c.d.ts  charlie
}

// Three hops and two renames between the name written here and the declaration.
export function callTop(input: string): string {
  return topFn(input);                     // -> chain-leaf.d.ts  leafFn
}

export function callRelay(payload: string): number {
  return new TopRelay().forward(payload);  // -> chain-leaf.d.ts  LeafRelay.forward
}
