'use strict';
// ── classes: inheritance, super, statics, accessors, fields, this.constructor ──
class Shape {
  constructor(name) { this.name = name; this.listeners = []; this.onChange = (v) => this.notify(v); }
  area() { return 0; }
  describe() { return this.name + ':' + this.area(); }
  static create(name) { return new this(name); }
  static compare(a, b) { return a.area() - b.area(); }
  get label() { return this.describe(); }
  set label(v) { this.name = v; }
  clone() { return new this.constructor(this.name); }
  subscribe(fn) { this.listeners.push(fn); return this; }
  notify(v) { this.listeners.forEach((l) => l(v)); return this; }
}
class Circle extends Shape {
  constructor(r) { super('circle'); this.r = r; }
  area() { return 3 * this.r * this.r; }
  describe() { return 'round ' + super.describe(); }
}
class Square extends Shape {
  area() { return 4; }
}
class Tagged extends Square {
  #secret() { return 'hidden'; }
  reveal() { return this.#secret(); }
  static [Symbol.hasInstance](x) { return x instanceof Square; }
}
module.exports = { Shape, Circle, Square, Tagged };
