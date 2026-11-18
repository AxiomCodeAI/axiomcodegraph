// A const annotated with a callable type and holding a function literal: the call's
// target is the literal's body, not the annotation's bodiless signature beside it.
export interface Format { (input: string): string }
export type Fn = (input: string) => string;
export const fromArrow: Format = (input) => input;
export const fromAlias: Fn = (input) => input;

// controls: the value is a factory's result, so the signature is the only answer.
declare function makeFormat(): Format;
export const made: Format = makeFormat();
