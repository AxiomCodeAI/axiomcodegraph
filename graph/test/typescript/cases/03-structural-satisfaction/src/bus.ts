import type { Pub } from "./pub";

// Sees Pub, shares the name `publish`, and still does not satisfy it: its publish needs
// two arguments where Pub's callers pass one.
export class Bus {
  publish(name: string, payload: unknown): void {}
}

export const bus = new Bus();
export type Seen = Pub;
