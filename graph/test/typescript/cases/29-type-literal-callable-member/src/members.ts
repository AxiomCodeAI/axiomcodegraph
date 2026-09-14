// WHICH MEMBER OF WHICH KIND OF OBJECT TYPE IS CALLABLE.
//
// Written as a matrix because the failing shape was originally attributed to
// intersections (#147), and the controls disprove that: the intersection's object half
// resolves, and the shape that fails also fails with no intersection anywhere. The
// discriminator is a function-valued PROPERTY whose owner is a TYPE LITERAL.

export interface Meta {
  describe(): string;
}

// ── the intersection, which works ───────────────────────────────────────────
export type Runner = ((n: number) => string) & {
  orig(n: number): string;
  meta: Meta;
};

export function callHalf(r: Runner): string {
  return r(1);
}

export function objectHalfMethod(r: Runner): string {
  return r.orig(2);
}

export function throughObjectHalf(r: Runner): string {
  return r.meta.describe();
}

// ── a METHOD in a type literal, which works ─────────────────────────────────
export type LiteralMethod = { run(n: number): string };

export function literalMethod(p: LiteralMethod): string {
  return p.run(1);
}

// ── a function-valued PROPERTY on an INTERFACE, which works ─────────────────
export interface Holder {
  run: (n: number) => string;
}

export function interfaceProperty(h: Holder): string {
  return h.run(1);
}

// ── a function-valued PROPERTY in a TYPE LITERAL, which does not ────────────
export type LiteralProperty = { run: (n: number) => string };

export function literalPropertyAliased(p: LiteralProperty): string {
  return p.run(1);
}

export function literalPropertyInline(p: { run: (n: number) => string }): string {
  return p.run(1);
}

export type OptionalLiteralProperty = { run?: (n: number) => string };

export function literalPropertyOptional(p: OptionalLiteralProperty): string | undefined {
  return p.run?.(1);
}
