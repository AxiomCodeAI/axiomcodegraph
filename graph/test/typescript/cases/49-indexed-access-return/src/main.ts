// A function declared `(): Zoo["dog"]` gave its result no type, so every call on that
// result was unresolved. The declaration says "the type of that property" and needs no
// inference to read: the reference's children ARE the object type and the index.
//
// The two forms return DIFFERENT classes on purpose. Scoring compares (caller, callee)
// pairs, so if both returned `Dog` the still-open generic form would deduplicate against
// the fixed literal one and the remaining gap could not be stated at all.
export class Dog { fetch(): void {} }
export class Cat { purr(): void {} }
export interface Zoo { dog: Dog; cat: Cat }
declare const zoo: Zoo;

export function getDog(): Zoo["dog"] { return zoo.dog; }
export function pick<K extends keyof Zoo>(k: K): Zoo[K] { return zoo[k]; }
export function getDogPlain(): Dog { return zoo.dog; }

export function use(): void {
  getDog().fetch();        // the case: a LITERAL index
  getDogPlain().fetch();   // control: the type written directly
}

export function useGeneric(): void {
  pick("cat").purr();      // still open: a TYPE VARIABLE index, see known-missing
}
