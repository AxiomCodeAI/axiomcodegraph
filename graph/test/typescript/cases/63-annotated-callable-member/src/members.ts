// WHICH DECLARATION A CALL REACHES WHEN THE DECLARATION CARRIES BOTH A CALLABLE TYPE
// AND THE BODY THAT IMPLEMENTS IT.
//
// Written as a MATRIX because two things differ between the shape that reaches the body
// and the shape that does not, and either could be the discriminator: whether the
// declaration is a VARIABLE or a class PROPERTY, and whether the annotation is an
// INLINE function type or a NAMED type carrying a call signature.
//
// THE INITIALISERS ANNOTATE THEIR OWN PARAMETER, which is not the subject here and is
// why: unannotated, the engine renders the arrow `varInline(?)` and the compiler oracle
// renders it `varInline(number)`, so the case failed on how a parameter whose type comes
// from the annotation is PRINTED, not on which declaration was reached. That belongs to
// its own case, and parking it in known-missing would record a gap that does not exist.
//
// EVERY ANNOTATION AND ITS INITIALISER ARE ON DIFFERENT LINES, deliberately. An earlier
// draft wrote each cell on one line, and the engine labels a target by owner and line,
// so `<arrow@15>` named either the inline annotation's own signature or the body and
// the golden could not say which. The line is the only discriminator the label carries,
// so the two have to occupy different ones.

export interface NamedCallable {
  (n: number): string;
}

// ── 1. variable, inline function type ───────────────────────────────────────
export const varInline: (
  n: number
) => string =
  (n: number) => 'v-inline' + n;

// ── 2. variable, named type ─────────────────────────────────────────────────
export const varNamed:
  NamedCallable =
  (n: number) => 'v-named' + n;

// ── 3. property, inline function type ───────────────────────────────────────
export class PropInline {
  run: (
    n: number
  ) => string =
    (n: number) => 'p-inline' + n;
}

// ── 4. property, named type ─────────────────────────────────────────────────
export class PropNamed {
  run:
    NamedCallable =
    (n: number) => 'p-named' + n;
}

export function callVarInline(): string { return varInline(1); }
export function callVarNamed(): string { return varNamed(2); }
export function callPropInline(p: PropInline): string { return p.run(3); }
export function callPropNamed(p: PropNamed): string { return p.run(4); }

// ── CONTROL: a plain method. One declaration, and it has the body, so there is
// nothing to choose and every cell above must agree with it or say why.
export class PlainMethod {
  run(n: number): string { return 'plain' + n; }
}
export function callPlainMethod(p: PlainMethod): string { return p.run(5); }

// ── CONTROL: an annotated declaration with NO body of its own. The named type is
// all there is, so resolving to its call signature is correct and must not change.
export declare const varAmbient: NamedCallable;
export function callVarAmbient(): string { return varAmbient(6); }
