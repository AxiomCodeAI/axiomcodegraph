// THE RECEIVER COMES OUT OF A CONTAINER. Nothing here writes a type on the variable that
// is called: it is read out of an array, a map, a tuple, a destructuring pattern or an
// index signature, and every one of those is a different rule.
import { Alpha, Beta, Gamma, Registry } from '@f/shapes';

// Element type of an array literal, and of an array parameter.
export function fromArray(items: Alpha[]): string {
  return items[0].tag();                       // Alpha.tag
}

export function fromLocalArray(): string {
  const items = [new Gamma(), new Gamma()];    // inferred Gamma[]
  return items[1].tag();                       // Gamma.tag — EXACT
}

// A TUPLE: the element type differs BY INDEX, so an engine that collapses a tuple to a
// single element type answers one of these two wrong.
export function fromTuple(pair: [Alpha, Beta]): string {
  return pair[0].tag() + pair[1].tag();        // Alpha.tag, then Beta.tag
}

// A standard-library generic container: the receiver is `Map<string, Beta>`'s VALUE type,
// which only exists after the type argument is substituted into `get`'s return type —
// and that return type is `Beta | undefined`, so the non-null assertion is part of the
// question.
export function fromMap(m: Map<string, Beta>): string {
  return m.get('k')!.tag();                    // Beta.tag
}

export function fromSet(s: Set<Alpha>): number {
  return s.size;
}

// An INDEX SIGNATURE: the member name is not declared anywhere in the type.
export function fromIndexSignature(reg: Registry): string {
  return reg['anything'].tag();                // Alpha.tag
}

// DESTRUCTURING, three ways: object pattern, array pattern, and a defaulted parameter
// pattern. In each the called name is bound by a pattern rather than by a declaration.
export function fromObjectPattern(box: { inner: Beta; other: Alpha }): string {
  const { inner, other } = box;
  return inner.tag() + other.tag();            // Beta.tag, Alpha.tag
}

export function fromArrayPattern(items: readonly [Gamma, Alpha]): string {
  const [first, second] = items;
  return first.tag() + second.tag();           // Gamma.tag, Alpha.tag
}

export function fromParamPattern({ inner }: { inner: Beta }): string {
  return inner.tag();                          // Beta.tag
}

// A REST parameter and a SPREAD argument: the callee's parameter type is the array's
// element type on one side and the array itself on the other.
export function fromRest(...items: Beta[]): string {
  return items.map((i) => i.tag()).join('');   // Beta.tag inside a lib callback
}

export function viaSpread(items: Beta[]): string {
  return fromRest(...items);
}

// A callback whose parameter type comes from the STANDARD LIBRARY's own signature. The
// receiver `a` is typed by `Array<Alpha>.sort`, not by anything written here.
export function fromLibCallback(items: Alpha[]): string[] {
  return items
    .filter((a) => a.tag() !== '')             // Alpha.tag
    .sort((a, b) => a.tag().localeCompare(b.tag()))
    .map((a) => a.tag());
}

// `reduce`, whose accumulator type is fixed by the initial value and not by the array.
export function fromReduce(items: Alpha[]): string {
  return items.reduce((acc, a) => acc + a.tag(), '');  // acc is string; a is Alpha
}
