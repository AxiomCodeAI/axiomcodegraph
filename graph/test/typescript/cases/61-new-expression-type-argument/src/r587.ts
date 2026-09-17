// A TYPE ARGUMENT ON A `new` EXPRESSION BINDS THE CLASS'S TYPE PARAMETER (#587).
//
// `new Box<AlphaOp>()` and `const b: Box<AlphaOp> = new Box<AlphaOp>()` are the same
// construct in two spellings, and only the second bound T. The difference is where the
// parser hangs the argument: an ANNOTATION carries it as a CHILD of the `Box` reference,
// a `new` carries it as a METHOD_TYPE_ARGUMENT anchored on the EXPRESSION beside the
// OBJECT_CREATION_TYPE reference. The annotation was the only shape substitution read.
//
// Every class here declares an EXPLICIT constructor, deliberately: #583 is a class with
// no constructor anywhere in its chain, and this case must not depend on it. Both `run`
// declarations are identical in shape so a name match cannot pass for a resolution.

import { LibBox, LibOp } from "../lib/store";

export class AlphaOp {
  run(x: number): number {
    return x + 1;
  }
}
export class BetaOp {
  run(x: number): number {
    return x * 2;
  }
}

export class Box<T> {
  private v!: T;
  constructor() {}
  get(): T {
    return this.v;
  }
  // The method's OWN type parameter, which is a different declaration from the class's
  // and must not be bound from the class's argument (or the other way round).
  pick<U>(u: U): U {
    return u;
  }
}

export interface Runner {
  run(x: number): number;
}

export class Bounded<T extends Runner> {
  private v!: T;
  constructor() {}
  get(): T {
    return this.v;
  }
}

export class Pair<A, B> {
  private a!: A;
  private b!: B;
  constructor() {}
  first(): A {
    return this.a;
  }
  second(): B {
    return this.b;
  }
}

export class Held<T> {
  constructor(private readonly v: T) {}
  get(): T {
    return this.v;
  }
}

export function sink(n: number): number {
  return n;
}

// ── THE CASE ────────────────────────────────────────────────────────────────
export function viaNewExplicit(): number {
  const b = new Box<AlphaOp>();
  return sink(b.get().run(1));
}

// CONTROL: the shape that already worked — the argument written on the ANNOTATION.
export function ctlAnnotated(): number {
  const b: Box<AlphaOp> = new Box<AlphaOp>();
  return sink(b.get().run(1));
}

// CONTROL: NO type argument written. T falls back to its CONSTRAINT, so the answer is
// the interface's `run` and must never be AlphaOp's — which is what says the binding
// comes from the argument on the `new` and not from the class being generic.
export function ctlNoTypeArgument(): number {
  const b = new Bounded();
  return sink(b.get().run(1));
}

// The receiver used immediately, with no variable in between.
export function viaNewChained(): number {
  return new Box<BetaOp>().get().run(1);
}

// TWO PARAMETERS: the join is positional, so A and B must not swap. One call per LINE,
// because the golden is keyed by line and two calls on one line cannot show which
// parameter bound which argument.
export function viaTwoParameters(): number {
  const p = new Pair<AlphaOp, BetaOp>();
  const first = p.first().run(1);
  const second = p.second().run(2);
  return first + second;
}

// The same positional question on a CALL rather than a `new`, and the SECOND parameter is
// the one that types the result: every expression type argument was emitted at position 0,
// so Y bound to nothing and this resolved to nothing.
export declare function make2<X, Y>(): Y;

export function viaSecondTypeArgument(): number {
  return make2<AlphaOp, BetaOp>().run(1);
}

// NESTED: the argument is itself a generic reference.
export function viaNestedGeneric(): number {
  const bb = new Box<Box<AlphaOp>>();
  return bb.get().get().run(1);
}

// A GENERIC METHOD on an instance built by `new`: U belongs to `pick`, T to `Box`.
export function viaGenericMethodOnNew(): number {
  return new Box<AlphaOp>().pick<BetaOp>(new BetaOp()).run(1);
}

// INFERRED: no annotation and no written type argument. T comes from the constructor
// ARGUMENT, which is unification rather than substitution. Pinned as it is, so the day
// it starts working is a visible diff.
export function viaInferredTypeArgument(): number {
  const h = new Held(new AlphaOp());
  return h.get().run(1);
}

// ── client -> library ───────────────────────────────────────────────────────
// A LIBRARY type as the type argument, and a LIBRARY generic taking a client one.
export function viaLibraryTypeArgument(): number {
  const b = new Box<LibOp>();
  return b.get().fire(1);
}

export function viaLibraryGeneric(): number {
  const b = new LibBox<AlphaOp>();
  return b.get().run(1);
}

export function main(): number {
  return viaNewExplicit() + ctlAnnotated() + ctlNoTypeArgument() + viaNewChained()
    + viaTwoParameters() + viaSecondTypeArgument() + viaNestedGeneric()
    + viaGenericMethodOnNew()
    + viaInferredTypeArgument() + viaLibraryTypeArgument() + viaLibraryGeneric();
}
