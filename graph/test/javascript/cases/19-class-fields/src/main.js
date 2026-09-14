'use strict';
class Service { run() { return 's'; } }
class Holder {
  dep = new Service();
  #priv = new Service();
  static shared = new Service();
  static #hidden = new Service();
  list = [new Service()];
  obj = { s: new Service() };
  fn = function () { return this.dep.run(); };
  go() { return this.dep.run() + this.#priv.run() + Holder.shared.run() + Holder.#hidden.run() + this.list[0].run() + this.obj.s.run() + this.fn(); }
  static sgo() { return this.shared.run(); }
}
new Holder().go(); Holder.sgo(); Holder.shared.run();
