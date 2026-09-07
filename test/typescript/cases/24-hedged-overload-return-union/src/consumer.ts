import type { Factory } from '../lib/widgets';

// WHAT THIS CASE PINS. `create` is a `keyof <map>`-keyed overload with a widening
// sibling — the shape of a typed registry, an event map, and the standard library's
// `document.createElement`. The factory call is answered with a sound SET.
//
// The property under test is at the NEXT hop: the value that set produced must be typed
// from the union of the candidates' return types, not from one member of it. Committing
// to one branch would make a sound answer at the first site an UNSOUND one at the second
// — the engine would name BaseWidget#attach where the compiler answers
// VideoWidget#attach, and no amount of widening the first answer could recover it.
//
// So the golden records all three `attach` declarations here and the oracle names
// VideoWidget#attach among them. Narrow the union to the widening branch and the oracle
// diff reports VideoWidget#attach MISSING, which fails.
export function viaVideo(f: Factory): void {
  const v = f.create('video');
  v.attach('a');
}

// Control: the widening overload IS the compiler's answer here, so BaseWidget#attach is
// correct and must stay in the set.
export function viaWidening(f: Factory, k: string): void {
  const w = f.create(k);
  w.attach('c');
}
