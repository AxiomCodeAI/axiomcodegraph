'use strict';
// ── classes beyond the basics: mixins, static inheritance, accessors, fields, private, setPrototypeOf, Reflect.construct ──
class Base {
  static registry = [];
  static make() { return new this(); }
  static describeAll() { return Base.registry.map((b) => b.id()); }
  static register(b) { Base.registry.push(b); return b; }
  count = 0;
  bump = () => { this.count += 1; return this.id(); };
  id() { return 'base'; }
  chain() { return this; }
  get svc() { return new Service(); }
  set svc(v) { this.count = v.id(); }
  #hidden() { return 'h'; }
  static #shared() { return 'sh'; }
  static shared() { return Base.#shared(); }
  viaPrivate() { return this.#hidden(); }
  [Symbol.iterator]() { let n = 0; const self = this; return { next() { n += 1; return { done: n > 2, value: self.id() }; } }; }
}
class Mid extends Base { id() { return 'mid:' + super.id(); } }
class Leaf extends Mid { id() { return 'leaf:' + super.id(); } }
class Service { id() { return 'svc'; } run() { return this.id(); } }
const Mixin = (Sup) => class extends Sup { mixed() { return 'mixed:' + this.id(); } };
class Mixed extends Mixin(Base) { own() { return this.mixed(); } }
const Cond = process.env.NOPE ? Mid : Leaf;
class Picked extends Cond { pick() { return this.id(); } }
function Legacy() { this.v = 1; }
Legacy.prototype.get = function () { return this.v; };
function Sub() { Legacy.call(this); }
Sub.prototype = Object.create(Legacy.prototype, { extra: { value: function () { return this.get() + 1; } } });
Object.setPrototypeOf(Sub, Legacy);
Sub.prototype.constructor = Sub;
function ReturnsObject() { return { m() { return 'explicit'; } }; }
class Singleton { static instance = new Singleton(); static get() { return Singleton.instance; } run() { return 'single'; } }
class Holder { constructor(dep) { this.dep = dep; this.own = new Service(); } go() { return this.dep.run() + this.own.run(); } }
class Container { static #inst; static get inst() { return Container.#inst ??= new Service(); } }
class Late {}
Late.prototype.late = function () { return 'late'; };
Late.staticLate = function () { return new Late(); };
class AsyncCls { async load() { return new Service(); } static async build() { return new AsyncCls(); } }
class Accessors { get pair() { return { run: () => this.tag() }; } tag() { return 'acc'; } }
class Nested { outer() { class Inner { in() { return 'in'; } } return new Inner().in(); } }
class WithNewTarget { constructor() { this.kind = new.target.name; } who() { return this.kind; } }
class Fluent { a() { return this; } b() { return this; } static c() { return new Fluent(); } }
module.exports = { Base, Mid, Leaf, Service, Mixed, Picked, Legacy, Sub, ReturnsObject, Singleton, Holder, Container, Late, AsyncCls, Accessors, Nested, WithNewTarget, Fluent, Mixin };
