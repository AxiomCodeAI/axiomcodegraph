// Dotted names in TYPE positions. `demanded_qualified_name` is seeded ONLY from
// type references, so a namespace exercised through value positions alone — which
// is what 07 does — leaves the qualified-name walk completely untested.

export namespace geo {
  export interface Point {
    move(dx: number): string;
  }
  export class Origin implements Point {
    move(dx: number): string {
      return "o" + dx;
    }
  }
  export namespace deep {
    export interface Box {
      // A dotted reference from INSIDE the namespace that declares it.
      fit(p: geo.Point): string;
    }
    export class Impl implements Box {
      fit(p: geo.Point): string {
        return p.move(1);
      }
    }
  }
}
