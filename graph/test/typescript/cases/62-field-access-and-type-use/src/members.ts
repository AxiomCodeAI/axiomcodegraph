// Every shape a PROPERTY ACCESS and a TYPE REFERENCE take, with the controls that prove
// neither relation is a name match. The goldens record the tier, the direction and the
// context on every row, so a receiver that stops resolving shows up as a declared unknown
// rather than as silence, and --oracle scores each row against the compiler's own symbol
// resolution.

export class Marker { tag = "m"; }

export interface Shaped { width: number; }

export class Box implements Shaped {
  width = 0;                                   // FIELD_TYPE (inferred), the member under test
  label: string;                               // FIELD_TYPE
  readonly marker: Marker = new Marker();      // FIELD_TYPE + OBJECT_CREATION_TYPE
  static total = 0;                            // a static, read through the class name
  private hidden = 1;

  constructor(label: string) { this.label = label; }

  // ── READ, in every position a read is written ─────────────────────────────
  plainRead(): number { return this.width; }
  otherRead(b: Box): string { return b.label; }
  staticRead(): number { return Box.total; }
  chained(): string { return this.marker.tag; }
  viaInterface(s: Shaped): number { return s.width; }

  // ── WRITE ─────────────────────────────────────────────────────────────────
  plainWrite(v: number): void { this.width = v; }
  otherWrite(b: Box, s: string): void { b.label = s; }
  staticWrite(v: number): void { Box.total = v; }

  // ── READWRITE: compound assignment and update ─────────────────────────────
  compound(v: number): void { this.width += v; }
  increment(): void { this.hidden++; }
  decrement(): void { --this.hidden; }

  // ── AN ACCESSOR IS NOT A FIELD ACCESS. It is a CALL, and call_edges carries it
  //    as PROPERTY_READ / PROPERTY_WRITE (#703). Here as the control that keeps the
  //    two tables disjoint: no field_access row may name `area`.
  get area(): number { return this.width * this.width; }
  set area(v: number) { this.width = v; }
  useAccessor(): number { this.area = 4; return this.area; }

  // ── A METHOD READ AS A VALUE is not a data edge either.
  run(): string { return this.label; }
  methodAsValue(): () => string { return this.run; }
}

// ── A SHADOWED MEMBER: the subclass redeclares the name, and `this.width` inside
//    Narrow is Narrow's declaration, not Box's.
export class Narrow extends Box {
  width = 1;
  own(): number { return this.width; }
}

// ── A RECEIVER THAT CANNOT BE TYPED must be a DECLARED UNKNOWN, not a dropped row.
export function unresolvable(x: any): unknown { return x.mystery; }

// ── TYPE USE, one reference per context the relation carries ────────────────
export type Alias = Marker;                         // TYPE_ALIAS_RHS
export interface Holder { item: Marker; }           // TYPE_ELEMENT
export const named: Marker = new Marker();          // VARIABLE_TYPE + OBJECT_CREATION_TYPE
export function param(m: Marker): Marker { return m; }        // METHOD_PARAM + METHOD_RETURN
export function generic(ms: Array<Marker>): void { void ms; }  // METHOD_PARAM + TYPE_ARGUMENT
export function asserted(x: unknown): Marker { return x as Marker; }   // AS_TARGET
export function satisfied(): unknown { return { item: new Marker() } satisfies Holder; } // SATISFIES_TARGET
export function bounded<T extends Marker>(t: T): T { return t; }        // TYPE_PARAM_BOUND
export class Derived extends Marker { }             // SUPER_TYPE
export class Conforms implements Shaped { width = 2; }  // IMPLEMENTS_INTERFACE

// ── The controls: a VARIABLE and a FUNCTION whose name is the type's. Neither is a
//    type use, and neither may appear as one.
export const Marker2 = 3;
export function Shaped2(): number { return Marker2; }
