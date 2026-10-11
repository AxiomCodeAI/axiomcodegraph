// A shared method NAME is not conformance. Pub has a declared implementor (Real) and a
// conformer the program builds and passes as a Pub (Duck, in duck-pub.ts). Two more
// classes share the name `publish` and are NOT Pubs:
//   * Bus (bus.ts) sees Pub but its publish needs two arguments — not assignable;
//   * Stranger (stranger.ts) has the right arity but no module that holds it ever
//     imports this one, so no instance of it can reach a Pub-typed slot.
// The control for Stranger is Declared (declared.ts): it never reaches this module either,
// but it imports a Pub from a package the walk cannot follow, so it stays a candidate.

export interface Pub {
  publish(e: { id: string }): void;
}

export class Relay {
  constructor(private readonly p: Pub) {}
  run(): void {
    this.p.publish({ id: "1" });
  }
}

export class Real implements Pub {
  publish(e: { id: string }): void {}
}

export function start(): void {
  new Relay(new Real()).run();
}
