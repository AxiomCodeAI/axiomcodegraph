'use strict';
const { Widget, Gadget } = require('./types');
const types = require('./types');
/** @param {Widget|Gadget} x */
function union(x) { return x.run(); }
/** @param {?Widget} x */
function nullable(x) { return x && x.run(); }
/** @param {Widget=} x */
function optional(x) { return x ? x.run() : ''; }
/** @param {Widget} [x] */
function bracketOptional(x) { return x ? x.run() : ''; }
/** @param {Widget[]} xs */
function arr(xs) { return xs.map((x) => x.run()); }
/** @param {Array<Widget>} xs */
function arr2(xs) { return xs[0].run(); }
/** @param {Record<string, Widget>} m */
function record(m) { return m.key.run() + m['other'].run(); }
/** @param {Object<string, Widget>} m */
function objMap(m) { return m.key.run(); }
/** @param {Map<string, Widget>} m */
function map(m) { return m.get('k').run(); }
/** @param {Set<Widget>} s */
function set(s) { return [...s][0].run(); }
/** @param {Promise<Widget>} p */
async function promise(p) { return (await p).run(); }
/** @returns {Promise<Widget>} */
async function returnsPromise() { return new Widget(); }
/** @returns {Widget} */
function returnsWidget() { return null; }
/** @param {import('./types').Widget} w */
function importType(w) { return w.run(); }
/** @param {import('./types').Options} o */
function optionsType(o) { return o.widget.run() + o.onDone(o.widget); }
/** @param {types.Gadget} g */
function qualified(g) { return g.spin(); }
/** @param {{ run: function(): string }} r */
function inlineShape(r) { return r.run(); }
/** @param {function(Widget): string} f */
function fnType(f) { return f(new Widget()); }
/** @param {(w: Widget) => string} f */
function tsFnType(f) { return f(new Widget()); }
/** @this {Widget} */
function thisTyped() { return this.run(); }
/** @type {Widget} */
let typedLet;
/** @type {Widget | null} */
let typedNull = null;
/** @type {Widget[]} */
const typedArr = [];
/** @type {{ w: Widget }} */
const typedShape = { w: new Widget() };
/** @type {Object<string, Widget>} */
const typedMap = {};
/** @type {Widget} */ (typedLet) && typedLet.run();
function typedVars() { typedNull && typedNull.run(); typedArr.push(new Widget()); typedArr[0].run(); typedShape.w.run(); typedMap.x = new Widget(); typedMap.x.run(); return /** @type {Gadget} */ (typedLet).spin(); }
/** @template T @param {T} x @returns {T} */
function identity(x) { return x; }
function generics() { identity(new Widget()).run(); return /** @type {Widget} */ (identity(null)).run(); }
class Doc {
  /** @type {Widget} */
  w;
  /** @type {Gadget|undefined} */
  g = undefined;
  static /** @type {Widget} */ sw = new Widget();
  constructor() { /** @type {Gadget} */ this.gg = new Gadget(); }
  /** @param {Widget} w */
  set widget(w) { this.w = w; }
  /** @returns {Widget} */
  get widget() { return this.w; }
  use() { this.w.run(); this.g && this.g.spin(); Doc.sw.run(); this.gg.spin(); this.widget.run(); return 0; }
}
/** @extends {Widget} */
class Ext extends Widget { extra() { return this.run(); } }
/** @augments Gadget */
class Aug extends Gadget { extra() { return this.spin(); } }
/** @implements {Runnable} */
class Impl { run() { return 'i'; } }
/** @constructor */
function Ctor() { this.v = new Widget(); }
Ctor.prototype.get = function () { return this.v.run(); };
/** @enum {number} */
const E = { A: 1 };
class Sub2 extends types.Widget { extra2() { return this.run(); } }
class Sub3 extends require('./types').Gadget { extra3() { return this.spin(); } }
module.exports = { union, nullable, optional, bracketOptional, arr, arr2, record, objMap, map, set, promise, returnsPromise, returnsWidget, importType, optionsType, qualified, inlineShape, fnType, tsFnType, thisTyped, typedVars, generics, Doc, Ext, Aug, Impl, Ctor, E, Sub2, Sub3 };
