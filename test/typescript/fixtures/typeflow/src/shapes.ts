// The vocabulary every other file in this fixture calls into. Three unrelated classes
// with a DELIBERATELY SHARED member name, so that landing on the right one is a question
// about the receiver's type and never about the member's name.
export class Alpha {
  tag(): string {
    return 'alpha';
  }
  only_alpha(): number {
    return 1;
  }
}

export class Beta {
  tag(): string {
    return 'beta';
  }
  only_beta(): number {
    return 2;
  }
}

export class Gamma extends Alpha {
  // Overrides. A receiver statically typed Alpha may reach either body; a receiver
  // known to be Gamma must reach exactly this one.
  tag(): string {
    return 'gamma';
  }

  // A member Alpha does not have. Without it Gamma is STRUCTURALLY IDENTICAL to Alpha,
  // and `x is Gamma` then narrows the negative branch to `never` rather than to Alpha —
  // which is a real compiler error in the fixture and would leave one site with no
  // answer for the oracle to give.
  only_gamma(): number {
    return 3;
  }
}

// A DISCRIMINATED UNION — the only structure in TypeScript where narrowing is total and
// the compiler's answer after the check is a single member.
// Both members are called `measure`. If they had different names the discriminant would
// never be exercised — the member name alone would pick the declaration, and the fixture
// would score a narrowing it never performed.
export interface Circle {
  readonly kind: 'circle';
  measure(): number;
  radius(): number;
}
export interface Square {
  readonly kind: 'square';
  measure(): number;
  side(): number;
}
export type Shape = Circle | Square;

export interface Registry {
  // An INDEX SIGNATURE: the member name is not in the type at all, and `reg['x'].tag()`
  // has to get its receiver from the signature's value type.
  [key: string]: Alpha;
}

// POLYMORPHIC `this`: the return type is the type of the receiver, so `new Gamma().self()`
// is a Gamma and not an Alpha, and the call after it dispatches accordingly.
export class Chainable {
  self(): this {
    return this;
  }
  step(): this {
    return this;
  }
  done(): string {
    return 'done';
  }
}
