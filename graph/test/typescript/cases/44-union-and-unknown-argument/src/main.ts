// An argument declared as a UNION is not assignable to one of the union's own members,
// and an `unknown` argument is assignable only to `unknown` or `any`. Both signatures
// below were candidates for every call, and being declared first the narrowest one took
// all three.
export interface ListT { kind: "list"; of(): string }
export interface NamedT { kind: "named"; name(): string }

export function describe(t: ListT): "list";
export function describe(t: ListT | NamedT): "list" | "named";
export function describe(t: unknown): "unknown";
// The implementation signature is spelled `any` rather than `unknown` deliberately: it
// is never selectable, and sharing a rendered label with the `unknown` OVERLOAD makes
// the two indistinguishable in the golden for a reason that has nothing to do with
// what this case tests.
export function describe(t: any): string { return String(t); }

export function use(l: ListT, u: ListT | NamedT, x: unknown): void {
  describe(l);   // control: a ListT argument really does reach the narrowest signature
  describe(u);   // the union: must NOT reach describe(ListT)
  describe(x);   // unknown: must reach only describe(unknown)
}
