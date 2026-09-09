// Every class shares the member name `handle`, so a name match cannot pass for a
// resolution: the OWNER is the whole answer.
export class ExplicitOne {
  readonly kindTag = "explicit" as const;
  handle(input: string): string {
    return input.toLowerCase();
  }
}
export class ImplicitOne {
  handle(input: string): string {
    return input.toUpperCase();
  }
}

// CONTROL — a type guard over a UNION receiver.
function isExplicit(x: ImplicitOne | ExplicitOne): x is ExplicitOne {
  return x instanceof ExplicitOne;
}
export function viaTypeGuard(u: ImplicitOne | ExplicitOne): string {
  if (isExplicit(u)) return u.handle("x");
  return u.handle("y");
}

// THE SITE UNDER TEST — an assertion signature, receiver declared `unknown`.
function assertExplicit(x: unknown): asserts x is ExplicitOne {
  if (!(x instanceof ExplicitOne)) throw new Error("no");
}
export function viaAssertsPredicate(x: unknown): string {
  assertExplicit(x);
  return x.handle("x");
}
