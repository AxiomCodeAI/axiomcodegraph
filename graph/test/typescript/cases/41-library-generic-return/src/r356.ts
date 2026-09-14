// THE NEIGHBOURS OF #356, PINNED. The defect itself — `Promise.resolve(x).then(...)`
// losing the substituted type — CANNOT be asserted by a case: its target is
// `lib.es5.d.ts:1557:5`, and a case's `lib/` directory is a client-authored second tree,
// not the TypeScript standard library. This file passes identically with and without the
// fix, and is not evidence for it. The corpus is; see the PR.
//
// What it does pin is the three mechanisms that had to stay working, each of which was
// measured EXACT while the defect was live, so a fix that reached the wrong axis breaks
// one of them here:
//
//   * a NON-GENERIC library return, chained     `s.toUpperCase().trim()`
//   * a CLIENT generic's return substituted     `identity(new AlphaOp()).run(1)`
//   * a client chain at three hops              `makeAlpha().self().self().run(1)`
//
// Both the class and the chain use `run`, so a name match cannot pass for a resolution.

export class AlphaOp {
  run(x: number): number {
    return x + 1;
  }
  self(): AlphaOp {
    return this;
  }
}

// CONTROL A: a non-generic library return, chained.
export function ctlNonGenericLibReturn(s: string): string {
  return s.toUpperCase().trim();
}

// THE SITE UNDER TEST: a library GENERIC's return. The callback parameter is annotated
// on purpose, so the body's `op.run(1)` is decided by the annotation and only `then`
// is in question.
export function viaGenericLibReturn(): Promise<number> {
  return Promise.resolve(new AlphaOp()).then((op: AlphaOp) => op.run(1));
}

// CONTROL B: a CLIENT generic's return substitutes.
export function identity<T>(v: T): T {
  return v;
}
export function ctlClientGenericReturn(): number {
  return identity(new AlphaOp()).run(1);
}

// CONTROL C: a client chain at three hops.
export function makeAlpha(): AlphaOp {
  return new AlphaOp();
}
export function ctlClientChainDepth(): number {
  return makeAlpha().self().self().run(1);
}

export function main(): Promise<number> {
  ctlNonGenericLibReturn('x');
  ctlClientGenericReturn();
  ctlClientChainDepth();
  return viaGenericLibReturn();
}
