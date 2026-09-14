// LIBRARY types whose instances travel through the CLIENT's flow layers before a call is
// made on them. The construction is client-side; only the TYPE it resolves to is
// library-side — the same shape java/type-resolution keys on, where
// object_creation_type_resolves is provenance-parametric and no instantiated-set ever
// crosses the boundary.
//
// The question each case below asks is whether the flow layer that carries the value —
// an array element, a tuple slot, a loop variable, an unannotated parameter — is itself
// provenance-parametric, or whether it only knows how to carry CLIENT types. A layer that
// is client-only loses the receiver here and the client->lib link with it.
export class Square {
  name(): string { return 'square'; }
}
export class Circle {
  name(): string { return 'circle'; }
}
export interface Shape {
  name(): string;
}
export declare function makeSquare(): Square;
