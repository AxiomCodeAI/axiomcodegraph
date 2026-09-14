// Every receiver here is a LIBRARY type that arrived through a client flow layer. A
// direct `new Square().name()` is the control: if that resolves and these do not, the
// defect is the layer and not the boundary.
import { Square, Circle, Shape, makeSquare } from "../lib/shapes";

export function control(): string {
  return new Square().name();            // direct construction — the control
}

export function viaLocal(): string {
  const s = new Square();                // an unannotated local
  return s.name();
}

export function viaArrayElement(): string {
  const xs = [new Square(), new Square()];
  return xs[0].name();                   // element_type_of over lib constructions
}

export function viaTupleSlot(): string {
  const pair: [Square, Circle] = [new Square(), new Circle()];
  return pair[1].name();                 // a tuple slot, positionally typed
}

export function viaForOf(): string {
  let out = '';
  for (const s of [new Square(), new Circle()]) {
    out += s.name();                     // the loop variable's element type
  }
  return out;
}

export function viaUnannotatedParam(): string {
  function take(s) {                     // no annotation — typed by the argument
    return (s as Square).name();
  }
  return take(new Square());
}

export function viaFactoryReturn(): string {
  const s = makeSquare();                // a library function's declared return
  return s.name();
}

export function viaTernary(f: boolean): string {
  const s = f ? new Square() : new Circle();
  return s.name();                       // a union of two library constructions
}

export function viaInterfaceTyped(s: Shape): string {
  return s.name();                       // a library-typed parameter
}

export function viaMap(m: Map<string, Square>): string {
  return m.get('k')!.name();             // a library type as a type argument
}
