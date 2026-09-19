// WHETHER AN IMPLEMENTATION THAT DECLARES FEWER PARAMETERS THAN ITS ANNOTATION
// SURVIVES ARITY MATCHING.
//
// `const f: (a, b) => R = x => x` is legal and ordinary TypeScript. Assignability
// permits a function with FEWER parameters where more are expected, and JavaScript
// ignores the excess arguments. So a call written against the ANNOTATION passes two
// arguments and reaches an implementation that declares one.
//
// The engine used to test `n <= max`, which dropped the only candidate that HAS A
// BODY and left the bodiless signature beside it standing alone as a `known_edge` --
// the strongest claim the graph makes, pointing at a type nobody can step into. The
// maximum is now relaxed for a HAS_BODY candidate only.
//
// WHY THIS IS A CASE OF ITS OWN. Case 63 already covers a declaration carrying both a
// callable type and its body, but every cell there gives the annotation and the
// implementation THE SAME ARITY, so it cannot fail if the relaxation is reverted. The
// arity MISMATCH is the whole discriminator here.
//
// WHAT THE DISCRIMINATOR IS. Read the `.edges` golden, not the `.oracle` one. `tsc`
// answers with the DECLARED TYPE -- the two-parameter call signature -- and is right to;
// the implementation surviving beside it is a claim about what RUNS, which the compiler
// oracle does not make and cannot score. Reverting the relaxation removes the arrow edge
// from every mismatch cell below and drops the tier back to `known_edge`, so the `.edges`
// golden is where it shows up.
//
// THE ANNOTATION IS A NAMED INTERFACE, not an inline function type, so that the target
// both sides name is the interface's call signature and the comparison is about which
// declarations are reached rather than about how a variable's type is printed. Case 63
// covers the inline-versus-named axis; repeating it here would only add label noise.
//
// EVERY ANNOTATION AND ITS INITIALISER ARE ON DIFFERENT LINES, as in case 63 -- the
// engine labels a target by owner and line, so a one-line cell cannot say whether the
// golden named the annotation's signature or the body.

export interface TwoArgs {
  (
    left: number,
    right: number
  ): number;
}

// ── 1. THE SHAPE. The annotation declares TWO parameters, the body declares ONE,
//       and the call passes two. The body must survive beside the signature.
export const declaresFewer:
  TwoArgs =
  (left: number) => left;
export function callDeclaresFewer(): number { return declaresFewer(1, 2); }

// ── 2. CONTROL: the body declares AS MANY as the annotation. Nothing was ever
//       dropped here, so this cell must read exactly as it did before the relaxation.
export const declaresSame:
  TwoArgs =
  (left: number, right: number) => left + right;
export function callDeclaresSame(): number { return declaresSame(1, 2); }

// ── 3. CONTROL: a class PROPERTY carrying the same mismatch, which does NOT recover
//       its implementation -- and the golden records that, because it is not an arity
//       effect and must not be read as one. Case 63's `callPropNamed` cell behaves
//       identically at EQUAL arity: a property annotated with a NAMED type reaches the
//       interface's call signature and never its initialiser, whatever the arities are.
//       So this cell is here to hold that route still, and pin the boundary of what the
//       relaxation recovers: the variable route, not the property-with-a-named-type one.
export class Holder {
  run:
    TwoArgs =
    (left: number) => left;
}
export function callHolderRun(h: Holder): number { return h.run(1, 2); }

// ── 4. CONTROL: an annotated declaration with NO body of its own. The signature is
//       all there is, so naming it stays correct and must not change.
export declare const ambient: TwoArgs;
export function callAmbient(): number { return ambient(1, 2); }

// ── 5. CONTROL: THE RELAXATION IS SCOPED TO `HAS_BODY`. These two call signatures are
//       BODILESS declared types, so their maximum still prunes -- that is what makes
//       choosing between siblings work, and it is the property the relaxation must not
//       touch. If it ever leaks past HAS_BODY, this is where it shows: `oneArg(1)` would
//       start reaching the two-parameter arm as well.
export interface Siblings {
  (
    a: number
  ): string;
  (
    a: number,
    b: number
  ): string;
}
export declare const siblings: Siblings;
export function callSiblingsOne(): string { return siblings(1); }
export function callSiblingsTwo(): string { return siblings(1, 2); }
