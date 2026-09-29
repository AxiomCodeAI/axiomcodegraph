import { Relay, type Pub } from "./pub";

// CONTROL: no `implements`, an extra optional parameter, and passed as a Pub — it stays
// a structural candidate of Pub.publish.
export class Duck {
  publish(e: { id: string }, trace?: string): void {}
}

export function wire(): void {
  const p: Pub = new Duck();
  new Relay(p).run();
}
