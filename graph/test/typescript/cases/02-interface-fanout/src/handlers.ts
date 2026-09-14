// Interface-typed receivers. The nominal answer is the interface signature; the
// reachability answer is the set of implementors. Both are pinned.

export interface Handler {
  handle(input: string): string;
}

export class UpperHandler implements Handler {
  handle(input: string): string {
    return input;
  }
}

export class LowerHandler implements Handler {
  handle(input: string): string {
    return input;
  }
}

// Declared but NEVER constructed: it is in the CHA set and out of the RTA set.
export class NeverBuiltHandler implements Handler {
  handle(input: string): string {
    return input;
  }
}

export function viaParameter(h: Handler): string {
  // Nothing is known about h beyond its declared type — this must fan.
  return h.handle("x");
}

export function viaMonomorphicConst(): string {
  const h: Handler = new LowerHandler();
  // Annotated Handler, but it PROVABLY holds a LowerHandler. Declared type is what
  // it IS; the flowed type is what it HOLDS, and dispatch asks the second question.
  return h.handle("x");
}

export function viaReassignedLet(flag: boolean): string {
  let h: Handler = new LowerHandler();
  if (flag) {
    h = new UpperHandler();
  }
  // Two values really can reach here, so two targets is the correct answer.
  return h.handle("x");
}

// ── client -> library ────────────────────────────────────────────────────────
import { Sink, ConsoleSink } from "../lib/contracts";

// A CLIENT class implementing a LIBRARY interface: the implementor set spans both.
export class ClientSink implements Sink {
  accept(value: string): void {}
}

export function useLibrary(s: Sink): string {
  s.accept("x");
  const own: Sink = new ClientSink();
  own.accept("y");
  new ConsoleSink().accept("z");
  return "";
}
