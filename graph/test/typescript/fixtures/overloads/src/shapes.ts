// Overloads separated by NAMED OBJECT TYPE. Nothing about arity or primitives
// distinguishes them, so an engine must compare the argument's resolved type against
// each parameter's resolved type.

export interface Circle {
  readonly kind: 'circle';
  readonly radius: number;
}

export interface Square {
  readonly kind: 'square';
  readonly side: number;
}

export function area(shape: Square): number;
export function area(shape: Circle): number;
export function area(shape: Circle | Square): number {
  return shape.kind === 'circle' ? Math.PI * shape.radius ** 2 : shape.side ** 2;
}
