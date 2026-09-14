// AN OVERLOADED TAG. A tagged template is how typed query builders, styled-component
// factories and i18n helpers present themselves, and they overload the tag precisely to
// distinguish what is being interpolated — so committing to signature 0 gives a
// confident wrong answer at exactly the sites the idiom exists to disambiguate (#354).
//
// The goldens are keyed by LINE, which is what makes this visible: both calls below
// share one caller and one callee name, so a comparison deduplicating on
// (caller, target) would show one agreed row and one extra and look self-consistent.

export function otag(strings: TemplateStringsArray, ...values: number[]): number;
export function otag(strings: TemplateStringsArray, ...values: string[]): string;
export function otag(
  strings: TemplateStringsArray,
  ...values: (number | string)[]
): number | string {
  return typeof values[0] === 'number' ? 1 : 'x';
}

export function viaTaggedOverload(): string {
  otag`n${1}`;
  return otag`s${'a'}` as string;
}

// CONTROL: a SINGLE-signature tag, which resolved all along.
export function stag(strings: TemplateStringsArray, ...values: number[]): number {
  return values.length;
}
export function ctlSingleSignature(): number {
  return stag`n${1}`;
}

// CONTROL: the same overload set called as an ORDINARY call, where selection is exact.
// If this regresses, the fix broke selection rather than reaching it.
export function ctlOrdinaryOverloadCall(): string {
  const s: TemplateStringsArray = Object.assign([''], { raw: [''] });
  otag(s, 1);
  return otag(s, 'a');
}

export function main(): string {
  ctlSingleSignature();
  ctlOrdinaryOverloadCall();
  return viaTaggedOverload();
}
