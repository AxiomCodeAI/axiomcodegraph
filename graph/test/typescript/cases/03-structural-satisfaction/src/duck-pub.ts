import { Relay, type Pub } from "./pub";

// CONTROL: no `implements`, an extra optional parameter, and passed as a Pub — it stays
// a structural candidate of Pub.publish.
export class Duck {
  publish(e: { id: string }, trace?: string): void {}
}

// Built beside a Pub and the right arity, but its publish is private: not assignable to Pub.
export class Hidden {
  private publish(e: { id: string }): void {}
}
export const hidden = new Hidden();

export function wire(): void {
  const p: Pub = new Duck();
  new Relay(p).run();
}
