// Class dispatch, super calls, abstract members, and static vs instance.
// Every call here has exactly one runtime target, so any fan is over-approximation.

export abstract class Shape {
  constructor(protected readonly label: string) {}
  describe(): string {
    return this.prefix() + this.label;
  }
  protected prefix(): string {
    return "shape:";
  }
  abstract area(): number;
  static origin(): string {
    return "0,0";
  }
}

export class Circle extends Shape {
  constructor(private readonly r: number) {
    super("circle");
  }
  protected override prefix(): string {
    // super.prefix() is a NON-VIRTUAL call: it must resolve to Shape#prefix and
    // never to Circle#prefix, which would be an infinite loop.
    return super.prefix() + "round:";
  }
  area(): number {
    return this.r * this.r;
  }
}

export class Square extends Shape {
  constructor(private readonly side: number) {
    super("square");
  }
  area(): number {
    return this.side * this.side;
  }
}

export function report(): string {
  const c = new Circle(2);
  const s = new Square(3);
  // Both receivers are monomorphic consts initialised with `new`, so describe()
  // and area() each have ONE target even though Shape has two subclasses.
  const a = c.describe() + c.area();
  const b = s.describe() + s.area();
  return a + b + Shape.origin();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Drawable, Palette } from "../lib/geometry";

// Extending a LIBRARY class: the super call crosses the boundary.
export class LibCircle extends Drawable {
  draw(): string {
    return this.outline() + "circle";
  }
}

export function useLibrary(): string {
  const p = Palette.default();
  const c = new LibCircle();
  return p.pick(1) + c.draw() + c.outline();
}
