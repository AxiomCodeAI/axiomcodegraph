/// <reference path="../lib/runtime.d.ts" />
// (The reference is for the compiler alone: the parser reads this directory only, so
// `Rt` reaches the engine as an unbound global name and the namespace as library IR.)
// A call through a const declared in a namespace. The const's type carries the call
// signature, and a member call one hop further needs the const's type as its receiver.
export function suite(): void {
  Rt.test("adds", () => {});
  Rt.test.only("focused", () => {});
  Rt.env.get("HOME");
}

// The same through a namespace declared in the project.
interface Runner { (n: number): number; describe(): string; }
interface Step { (n: number): number; }
declare function makeRunner(): Runner;
namespace Local {
  export const run: Runner = makeRunner();
  export const arrow: Step = (n) => n + 1;
  export function helper(): void {}
}
export function local(): void {
  Local.run(1);
  Local.run.describe();
}

// controls: a namespace function keeps its one edge; a const holding an arrow keeps its
// body as the target with no bodiless signature beside it; a parameter that shadows the
// namespace's name resolves against its own type.
export function controls(): void {
  Rt.serve(8000);
  Local.helper();
  Local.arrow(2);
}
export function shadowed(Rt: { test(name: string): void }): void {
  Rt.test("shadowed");
}
