// NARROWING. Before the guard the receiver is a union and any member call on it would be
// a fan; after the guard the compiler has exactly one type, and so should the engine.
//
// The classes share a member name on purpose (`tag`), so "which declaration" is decided
// by the narrowing and by nothing else. Every site here has one right answer.
import { Alpha, Beta, Gamma, Shape } from '@f/shapes';

// `instanceof` — the narrowing a Java-shaped engine already knows how to do.
export function viaInstanceof(x: Alpha | Beta): string {
  if (x instanceof Beta) return x.tag();       // Beta.tag
  return x.tag();                              // Alpha.tag (or Gamma.tag: Gamma extends Alpha)
}

// A DISCRIMINANT: no instanceof, no class, just a literal-typed property. The member is
// declared on BOTH arms under one name, so the discriminant is the only thing that can
// separate them and a fan of two is a measurable failure rather than caution.
export function viaDiscriminant(s: Shape): number {
  if (s.kind === 'circle') return s.measure();  // Circle.measure
  return s.measure();                           // Square.measure
}

// The same shape with the members NAMED APART, which is the control: an engine with no
// narrowing at all still gets these two right, and the pair tells the two apart.
export function viaDiscriminantNamedApart(s: Shape): number {
  if (s.kind === 'circle') return s.radius();  // Circle.radius
  return s.side();                             // Square.side
}

// `typeof` on a primitive union, then a call into the STANDARD LIBRARY: the target of
// each branch is a different lib.es5 declaration.
export function viaTypeof(v: string | number): string {
  if (typeof v === 'string') return v.toUpperCase();  // String.toUpperCase
  return v.toFixed(2);                                // Number.toFixed
}

// The same guard, but the member exists on BOTH arms — so the branch, and not the member
// name, has to choose between String.toString and Number.toString.
export function viaTypeofSharedName(v: string | number): string {
  if (typeof v === 'string') return v.toString();     // String.toString
  return v.toString();                                // Number.toString
}

// Narrowing by a USER-DEFINED TYPE PREDICATE — the compiler believes the signature, not
// the body, so an engine that reads the body learns the wrong thing.
export function isGamma(x: Alpha): x is Gamma {
  return x instanceof Gamma;
}
export function viaPredicate(x: Alpha): string {
  if (isGamma(x)) return x.tag();              // Gamma.tag — EXACT, no fan
  return x.tag();                              // Alpha.tag
}

// `in` narrowing, which is how a union without a discriminant is separated.
export function viaIn(x: Alpha | Beta): number {
  if ('only_beta' in x) return x.only_beta();  // Beta.only_beta
  return x.only_alpha();                       // Alpha.only_alpha
}

// A union where NOTHING narrows. The right answer here is a FAN of two, and an engine
// that names one is wrong rather than precise — the opposite failure to the rest of
// this file, and the reason both belong in one fixture.
export function unnarrowed(x: Alpha | Beta): string {
  return x.tag();                              // Alpha.tag AND Beta.tag
}

// Narrowing that is UNDONE by an assignment. After the reassignment the earlier guard
// tells you nothing, and an engine that keeps the narrowed type is unsound.
export function reassigned(x: Alpha | Beta, fresh: Beta): string {
  if (x instanceof Alpha) {
    x = fresh;
    return x.tag();                            // Beta.tag — NOT Alpha.tag
  }
  return x.tag();
}
