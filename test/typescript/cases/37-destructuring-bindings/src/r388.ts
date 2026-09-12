// ARRAY AND TUPLE DESTRUCTURING as a receiver source. #355 typed the object form
// (`const { helper } = ctx`) and left the two index forms; the parser has emitted them
// all along as bindingSourceKind=INDEX with the position as the source, and nothing read
// it (#388).
//
// Both classes declare `apply`, so a name match cannot pass for a resolution — only the
// OWNER distinguishes a right answer from a wrong one. Every destructuring form below
// sits beside a control of the same shape that already resolved, so a regression in the
// control and a failure of the new form are told apart.

export class IncrementOp {
  apply(x: number): number {
    return x + 1;
  }
}
export class DoubleOp {
  apply(x: number): number {
    return x * 2;
  }
}

export interface Ctx {
  helper: IncrementOp;
}

export function makePair(): [DoubleOp, DoubleOp] {
  return [new DoubleOp(), new DoubleOp()];
}

// ── the two shapes #388 is about ───────────────────────────────────────────
export function viaArrayDestructure(ops: IncrementOp[], input: number): number {
  const [first] = ops;
  return first === undefined ? input : first.apply(input);
}

export function viaTupleDestructure(input: number): number {
  const [a, b] = makePair();
  return a.apply(b.apply(input));
}

// ── controls ───────────────────────────────────────────────────────────────
// INDEX ACCESS on the same container — the form that already resolved.
export function ctlIndexAccess(input: number): number {
  const pair = makePair();
  return pair[0].apply(input);
}

// OBJECT destructuring — what #355 fixed; here to catch a regression in it.
export function ctlObjectDestructure(ctx: Ctx, input: number): number {
  const { helper } = ctx;
  return helper.apply(input);
}

// A plain binding through the element, with no pattern at all.
export function ctlElementBinding(ops: IncrementOp[], input: number): number {
  const first = ops[0];
  return first.apply(input);
}

export function main(): number {
  return (
    viaArrayDestructure([new IncrementOp()], 1) +
    viaTupleDestructure(2) +
    ctlIndexAccess(3) +
    ctlObjectDestructure({ helper: new IncrementOp() }, 4) +
    ctlElementBinding([new IncrementOp()], 5)
  );
}
