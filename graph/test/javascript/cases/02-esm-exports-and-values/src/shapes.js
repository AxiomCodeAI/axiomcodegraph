export function named(a) { return a; }
export const arrowExp = (b) => named(b);
export default function dflt() { return 1; }
export class Widget {
  constructor() { this.count = 0; this.handler = function () { return this.count; }; }
  inc() { this.count++; return this; }
  dec() { return this.inc(); }
  static create() { return new Widget(); }
  get value() { return this.count; }
}
export const Klass = class { run() { return 2; } };
export const registry = {
  start() { return this.stop(); },
  stop() { return 0; },
  nested: { deep() { return 3; } },
};
export function takesCb(cb) { return cb(1); }
export function returnsWidget() { return new Widget(); }
/** @returns {Widget} */
export function documented() { return null; }
/** @type {Widget} */
export let typedLet = null;
export function Proto() {}
Proto.prototype = {
  alpha() { return 1; },
  beta: function () { return this.alpha(); },
};
Object.assign(Proto.prototype, { gamma() { return 2; } });
export const wid = new Widget();
