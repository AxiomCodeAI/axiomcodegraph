// AN EXPLICIT TYPE ARGUMENT IS A WRITTEN-DOWN TYPE. It typed the result of a generic
// call only where the type ALSO appeared somewhere else — in a parameter, or in an
// annotation on the receiving variable. Where the type argument is the SOLE source of
// the return type, the result was untyped and every call on it resolved to nothing
// (#353).
//
// Both classes declare `run`, so a name match cannot pass for a resolution.

export class AlphaOp {
  run(x: number): number {
    return x + 1;
  }
}
export class BetaOp {
  run(x: number): number {
    return x * 2;
  }
}

export declare function make<T>(): T;
export declare function makeFrom<T>(seed: T): T;

// The shape under test: T is the ONLY source of the return type.
export function viaExplicitTypeArg(): number {
  const op = make<AlphaOp>();
  return op.run(1);
}

// CONTROL: the same call, with the type also written on the receiving const.
export function ctlAnnotatedConst(): number {
  const op: AlphaOp = make<AlphaOp>();
  return op.run(1);
}

// CONTROL: the same type argument, but it also appears in a PARAMETER, so inference
// has a second source.
export function ctlTypeArgWithParam(): number {
  const op = makeFrom<BetaOp>(new BetaOp());
  return op.run(1);
}

// CONTROL: no generic at all.
export function ctlDirectConstruction(): number {
  const op = new AlphaOp();
  return op.run(1);
}

// The receiver used immediately, with no binding in between.
export function viaExplicitTypeArgChained(): number {
  return make<BetaOp>().run(1);
}

export function main(): number {
  return viaExplicitTypeArg() + ctlAnnotatedConst() + ctlTypeArgWithParam()
    + ctlDirectConstruction() + viaExplicitTypeArgChained();
}
