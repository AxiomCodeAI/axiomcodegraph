// OVERLOAD RESOLUTION ACROSS THE LIBRARY BOUNDARY. The client-side fixture already
// measures overloads inside one project; this asks the strictly harder question,
// because the candidate set now has to survive being extracted, staged and re-linked
// as library IR before it can be compared.
//
// The order is hostile in the same way and for the same reason: the answer for the most
// ordinary argument is never declaration 0.
export declare function convert(value: string, radix: string): string;
export declare function convert(value: number, radix: number): number;
export declare function convert(value: boolean): boolean;

// Arity alone.
export declare function join(a: string): string;
export declare function join(a: string, b: string): string;
export declare function join(a: string, b: string, c: string): string;

export interface Frame {
  readonly kind: 'frame';
  readonly width: number;
}
export interface Panel {
  readonly kind: 'panel';
  readonly height: number;
}

export declare class Painter {
  // Overloaded METHOD whose parameter types are declared in this same file, so the
  // argument's type has to be resolved through the library's own type graph.
  draw(target: Panel): number;
  draw(target: Frame): number;
  draw(target: string): number;

  // An overloaded CONSTRUCTOR reached through `new`.
  constructor();
  constructor(seed: string);
  constructor(seed: number, scale: number);
}
