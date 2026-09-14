// A FUNCTION VALUE BOUND TO A NAME, in each of the three containers that can hold one.
// Each is written beside an ordinary declaration of the same kind, so the control and the
// site under test differ only in how the callable was introduced.

export const handlers = {
  viaArrow: (n: number): number => n + 1,
  // CONTROL: a shorthand method in the same literal.
  viaShorthand(n: number): number {
    return n + 2;
  },
};

export function callObjectLiteral(n: number): number {
  return handlers.viaArrow(n) + handlers.viaShorthand(n);
}

export class Holder {
  readonly viaField = (n: number): number => n + 3;

  // CONTROL: an ordinary method declaration on the same class.
  viaMethod(n: number): number {
    return n + 4;
  }
}

export function callClassMembers(n: number): number {
  const h = new Holder();
  return h.viaField(n) + h.viaMethod(n);
}

export namespace util {
  export const viaConst = (n: number): number => n + 5;

  // CONTROL: an ordinary exported function in the same namespace.
  export function viaFunction(n: number): number {
    return n + 6;
  }
}

export function callNamespaceMembers(n: number): number {
  return util.viaConst(n) + util.viaFunction(n);
}

// Entry point, so no declaration is reachable only by the calls under test.
export function main(): number {
  return callObjectLiteral(1) + callClassMembers(1) + callNamespaceMembers(1);
}
