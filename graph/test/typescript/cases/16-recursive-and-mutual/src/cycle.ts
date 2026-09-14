// Self-recursion and mutual recursion. The chain rules must terminate and must
// still record both directions of the cycle.

export function ping(n: number): number {
  if (n <= 0) return 0;
  return pong(n - 1);
}

export function pong(n: number): number {
  if (n <= 0) return 0;
  return ping(n - 1);
}

export class Tree {
  children: Tree[] = [];
  // Direct self-recursion through a member.
  size(): number {
    let total = 1;
    for (const c of this.children) {
      total += c.size();
    }
    return total;
  }
}

export function drive(): number {
  return ping(3) + new Tree().size();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Walker, bounce } from "../lib/walker";

export function useLibrary(): number {
  // Recursion INSIDE the library, entered from the client: the chain must terminate
  // across the boundary too.
  return new Walker().step(3) + bounce(2);
}
