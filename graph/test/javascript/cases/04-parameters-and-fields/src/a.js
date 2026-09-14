function ident(n) { return n; }
export function f(a, modifier = (n) => n, other = ident) { modifier(a); other(a); }
export function g({ modifier = (x) => x, second = ident } = {}) { modifier(1); second(2); }
export class K {
  /** @type {(n: string) => string} */
  typed;
  handler = (x) => ident(x);
  run() { this.typed('a'); this.handler(1); }
}
