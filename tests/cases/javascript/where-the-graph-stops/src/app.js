// Two calls the engine deliberately does not follow: the callee is ambient (the platform's
// Array#push, JSON.stringify), so the graph ends there. Java and Python name such a callee
// (boundary_lib); JavaScript and TypeScript record no callee at all, and the name survives
// only at the call site.
export class Bag {
  constructor() { this.items = []; }
  add(x) {
    this.items.push(x);
    return JSON.stringify(this.items);
  }
}

export function run() {
  const b = new Bag();
  return b.add(1);
}
