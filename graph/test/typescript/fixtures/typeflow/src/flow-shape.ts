// THE TYPE IS COMPUTED. Accessors, statics, generics, type queries and the type-level
// operators — every receiver here has a type the compiler DERIVED rather than read.
import { Alpha, Beta, Gamma } from '@f/shapes';

// ── accessors ────────────────────────────────────────────────────────────────
// A getter is a declaration whose call site does not look like a call. `holder.current`
// is a member ACCESS whose type is the getter's return type, and the call after it
// dispatches on that.
export class Holder {
  private value: Alpha = new Gamma();

  get current(): Alpha {
    return this.value;
  }
  set current(next: Alpha) {
    this.value = next;
  }

  // A STATIC, and a static that returns an instance — so `Holder.make().current.tag()`
  // crosses the static/instance boundary twice.
  static make(): Holder {
    return new Holder();
  }
}

export function viaGetter(h: Holder): string {
  return h.current.tag();                      // Alpha.tag, through the getter's return type
}

export function viaStaticThenGetter(): string {
  return Holder.make().current.tag();
}

// A static inherited by a subclass: the receiver is the SUBCLASS and the declaration is
// on the base.
export class SubHolder extends Holder {}
export function viaInheritedStatic(): string {
  return SubHolder.make().current.tag();
}

// ── generics ─────────────────────────────────────────────────────────────────
// T is bound by the ARGUMENT and the member called on the result is on the argument's
// type. Nothing in `identity`'s declaration mentions `tag`.
export function identity<T>(value: T): T {
  return value;
}
export function viaGenericIdentity(): string {
  return identity(new Beta()).tag();           // Beta.tag — EXACT
}

// A CONSTRAINED type parameter: the member is guaranteed by the constraint, so the
// declaration a call resolves to is on the constraint's type.
export function tagOf<T extends Alpha>(value: T): string {
  return value.tag();                          // Alpha.tag
}

// A generic CLASS with a method that reuses the class's parameter, and a method that
// introduces its own.
export class Box<T> {
  constructor(private readonly value: T) {}
  get(): T {
    return this.value;
  }
  map<U>(fn: (value: T) => U): Box<U> {
    return new Box(fn(this.value));
  }
}
export function viaGenericClass(): string {
  return new Box(new Gamma()).get().tag();     // Gamma.tag — EXACT
}
export function viaGenericMethod(): number {
  return new Box(new Beta()).map((b) => b.only_beta()).get();
}

// A DEFAULT type parameter: `Box2` with no type argument is `Box2<Alpha>`.
export class Box2<T = Alpha> {
  constructor(readonly value: T) {}
}
export function viaDefaultTypeArg(): string {
  return new Box2(new Alpha()).value.tag();
}

// ── type-level operators ─────────────────────────────────────────────────────
// A TYPE ALIAS around a union, an INDEXED ACCESS type, and a `typeof` type query. Each
// puts one more step between the annotation and the declaration it names.
type Pair = { left: Alpha; right: Beta };
type Left = Pair['left'];

export function viaIndexedAccessType(l: Left): string {
  return l.tag();                              // Alpha.tag
}

const template = new Beta();
export function viaTypeQuery(x: typeof template): number {
  return x.only_beta();                        // Beta.only_beta
}

// A CONDITIONAL type that resolves to one branch, and a MAPPED type whose property types
// are rewritten. Both are types the engine has to evaluate rather than look up.
type Unwrap<T> = T extends Box<infer U> ? U : never;
export function viaConditionalType(u: Unwrap<Box<Gamma>>): string {
  return u.tag();                              // Gamma.tag
}

type Boxed<T> = { [K in keyof T]: Box<T[K]> };
export function viaMappedType(b: Boxed<Pair>): string {
  return b.left.get().tag();                   // Box.get, then Alpha.tag
}

// `satisfies` keeps the literal's narrow type while checking it against a wider one, so
// the receiver after it is the LITERAL's type and not the annotation's.
const wired = { primary: new Gamma() } satisfies Record<string, Alpha>;
export function viaSatisfies(): string {
  return wired.primary.tag();                  // Gamma.tag — EXACT, not Alpha.tag
}
