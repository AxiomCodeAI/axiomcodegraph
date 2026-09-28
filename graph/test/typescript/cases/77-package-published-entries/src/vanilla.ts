// Published under "./vanilla" as build output (dist/esm/vanilla.mjs). Imported by index.ts
// and by the test, so it is not an unimported module: before #847 nothing here was a root.
export function createStore(initial: number) {
  return seal(initial);
}

function seal(value: number) {
  return { value };
}

// The ecosystem's usual spelling of a published function: a const bound to an arrow.
export const createBoundStore = (initial: number) => seal(initial * 2);

// CONTROL: a published const that is a value, not a function. Roots nothing.
export const DEFAULT_INITIAL = 0;

// A library giving an arrow a declared type: the arrow is under parentheses and `as`.
export const createCastStore = ((initial: number) => seal(initial + 1)) as (initial: number) => { value: number };

// CONTROL: a value under the same assertion. Binds no function, roots nothing.
export const castInitial = (DEFAULT_INITIAL as number);
