// Functions as values: arrows bound to consts, callbacks passed and invoked,
// a function stored in a readonly field, and a method used as a value.

export type Transform = (s: string) => string;

export const upper: Transform = (s) => s + "U";
export const lower: Transform = (s) => s + "l";

export function apply(t: Transform, s: string): string {
  // Calling a PARAMETER. Its declared type is a function type, not a class, so the
  // target is the call signature — and the arrows that flow here are the fan.
  return t(s);
}

export class Pipeline {
  private readonly step: Transform = upper;
  run(s: string): string {
    // Calling through a readonly field initialised with a known function value.
    return this.step(s);
  }
  tag(s: string): string {
    return s + "#";
  }
}

export function drive(): string {
  const p = new Pipeline();
  // A method used as a VALUE, then called.
  const asValue: Transform = p.tag.bind(p);
  return apply(upper, "a") + apply(lower, "b") + p.run("c") + asValue("d");
}

// ── client -> library ────────────────────────────────────────────────────────
import { withHook, identity, Hook } from "../lib/hooks";

export function useLibrary(): string {
  const local: Hook = (s) => s + "!";
  // A CLIENT arrow passed into a LIBRARY higher-order function, and a LIBRARY
  // function value called from client code.
  return withHook(local, "a") + withHook(identity, "b") + identity("c");
}
