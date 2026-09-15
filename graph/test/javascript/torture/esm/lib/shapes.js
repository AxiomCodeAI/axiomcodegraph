// ── ES classes exported by name, by default, and through a namespace ──
export class Shape {
  constructor(name) { this.name = name; this.listeners = []; }
  area() { return 0; }
  describe() { return this.name + ':' + this.area(); }
  static create(name) { return new this(name); }
  subscribe(fn) { this.listeners.push(fn); return this; }
  notify(v) { this.listeners.forEach((l) => l(v)); return this; }
}
export class Circle extends Shape {
  constructor(r) { super('circle'); this.r = r; }
  area() { return 3 * this.r * this.r; }
  describe() { return 'round ' + super.describe(); }
}
export default class Square extends Shape { area() { return 4; } }
export const util = { twice: (x) => x * 2, inc(x) { return x + 1; } };
export function compare(a, b) { return a.area() - b.area(); }
export let counter = 0;
export function bump() { counter += 1; return counter; }
