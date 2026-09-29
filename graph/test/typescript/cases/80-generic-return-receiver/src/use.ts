// A receiver whose type is what a GENERIC or computed call returns. Each shape is
// statically typed by the compiler, so each `.m()` below has one declared target.

export interface Warrior { fight(): string; }
export class Ninja implements Warrior { fight(): string { return "ninja"; } }

export class User {
  touch(): string { return "t"; }
  save(): string { return "s"; }
}

export interface Shape { area(): number; }
export class Sq implements Shape { constructor(private s: number) {} area(): number { return this.s * this.s; } }
export class Circ implements Shape { constructor(private r: number) {} area(): number { return 3 * this.r * this.r; } }

// ── the gap ──────────────────────────────────────────────────────────────────
// `Map<string, User>` built with `new`, read with `.get(k)!`.
export function recvMapGet(): string {
  const m = new Map<string, User>();
  return m.get("x")!.touch();
}

// A function-typed PARAMETER with its own type parameter, called with a written argument.
export function recvGeneric(get: <T>() => T): string {
  return get<User>().touch();
}

// An index-signature object whose values are factories; the element is CALLED.
const factories: { [k: string]: (n: number) => Shape } = {
  sq: (n) => new Sq(n),
  circ: (n) => new Circ(n),
};
export function totalArea(kind: string, n: number): number {
  return factories[kind](n).area();
}

// The same through a declared Record alias.
const makers: Record<string, (n: number) => Shape> = { sq: (n) => new Sq(n) };
export function recordArea(kind: string, n: number): number {
  return makers[kind](n).area();
}

// An inline index signature whose value is NOT a function: the element is a Shape.
const shapes: { [k: string]: Shape } = { sq: new Sq(1) };
export function indexValue(kind: string): number {
  return shapes[kind].area();
}

// T bound from the ARGUMENT of a generic function-typed parameter.
export function recvGenericArg(pick: <T>(x: T) => T, u: User): string {
  return pick(u).save();
}

// ── controls: already typed, must not change ────────────────────────────────
export function ctlDeclared(): string {
  const u: User = JSON.parse("{}");
  return u.save();
}
export function ctlCast(): string {
  const u = JSON.parse("{}") as User;
  return u.save();
}
// ── controls: nothing names the type, so these must STAY unresolved ─────────
// The written type argument is `any`: T is untyped, and `.touch()` is a name only.
export function ctlGenericUnbound(get: <T>() => T): string {
  return get<any>().touch();
}
// An index signature over `any`: the element is untyped.
const anyBag: { [k: string]: any } = {};
export function ctlAnyIndex(kind: string): number {
  return anyBag[kind].area();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Container, Registry } from "../lib/container";

const container = new Container();
const WARRIOR = Symbol.for("Warrior");
container.bind<Warrior>(WARRIOR);

export function run(): string {
  const w = container.get<Warrior>(WARRIOR);
  return w.fight();
}

export function viaRegistry(r: Registry<User>): string {
  return r.lookup("x")!.touch();
}
