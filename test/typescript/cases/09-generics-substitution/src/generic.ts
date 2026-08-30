// Generic substitution: a type argument on the RECEIVER must flow into the
// return type, or the next segment of the chain has no receiver at all.

export class Item {
  ping(): string {
    return "ping";
  }
}

export class Box<T> {
  constructor(private readonly value: T) {}
  get(): T {
    return this.value;
  }
  map<U>(f: (t: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

export function fromReceiver(): string {
  const b = new Box<Item>(new Item());
  // b.get() returns T, and T is bound to Item BY THE RECEIVER's type argument.
  // This is substitution and it is expected to work.
  return b.get().ping();
}

export function fromArgument<T>(xs: T[], pick: (x: T) => T): T {
  return pick(xs[0]!);
}

export function inferredFromArgument(): string {
  const items = [new Item()];
  // Here T is inferred from the ARGUMENT, which is unification rather than
  // substitution. Pinned so the day it starts working is a visible diff.
  return fromArgument(items, (x) => x).ping();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Cell, unwrap } from "../lib/container";

export function useLibrary(): string {
  const c = new Cell<Item>(new Item());
  // Substitution ACROSS the boundary: T is bound by the client's type argument and
  // the member being reached is declared in the library.
  return c.value().ping() + unwrap(c).ping();
}
