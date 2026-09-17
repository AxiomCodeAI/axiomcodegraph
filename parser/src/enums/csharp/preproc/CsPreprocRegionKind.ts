/**
 * One branch of a conditional-compilation chain — `cs_preproc_region.regionKind`.
 *
 * The chain is `#if` → `#elif`* → `#else`, and in this grammar it NESTS: the
 * `#elif` is a CHILD of the `#if` and the `#else` a child of the last `#elif`.
 * A walker treating them as siblings descends into the `#else` body believing
 * it is still inside the `#if`, which duplicates the subtree — and duplicates
 * DOUBLE.
 */
export enum CsPreprocRegionKind {
  IF = 'IF',
  ELIF = 'ELIF',
  ELSE = 'ELSE',
}
