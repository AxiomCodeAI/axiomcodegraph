// A call through an interface-typed receiver fans to every declared implementor by
// default. `--closed-world on` narrows that fan to what the program can build (#473).
// Each class below is one shape of "can the program build it":

export interface Handler {
  handle(x: string): string;
}

// constructed with `new`: stays in the narrowed fan
export class Built implements Handler {
  handle(x: string): string { return "b" + x; }
}

// never written in a `new`, but handed to a registry as a class VALUE that constructs it:
// stays, because a class that escapes as a value can be built where the parser cannot see
export class Registered implements Handler {
  handle(x: string): string { return "r" + x; }
}

// named only as a TYPE: nothing can build it, so the narrowed fan drops it
export class Unused implements Handler {
  handle(x: string): string { return "u" + x; }
}

// never constructed itself, but a constructed subclass inherits its body: stays
export abstract class Base implements Handler {
  handle(x: string): string { return "base" + x; }
}
export class Leaf extends Base {}

// a subclass nobody constructs, overriding: dropped
export class Orphan extends Base {
  handle(x: string): string { return "o" + x; }
}

type HandlerClass = new () => Handler;
const registry: HandlerClass[] = [];
export function register(c: HandlerClass): void { registry.push(c); }
register(Registered);

export function dispatch(h: Handler, x: string): string {
  return h.handle(x);
}

export function main(): void {
  const built = new Built();
  const leaf = new Leaf();
  let later: Unused | undefined;
  let other: Orphan | undefined;
  dispatch(built, "1");
  dispatch(leaf, "2");
  for (const C of registry) dispatch(new C(), "3");
  void later;
  void other;
}
