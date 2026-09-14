'use strict';
const ns = require('./base');
const { Base } = require('./base');
class TopDecl extends ns.Base { a() { return this.id(); } }
const TopExpr = class extends ns.Base { b() { return this.id(); } };
const TopExprNamed = class Named extends ns.Base { c() { return this.id(); } };
const TopPlain = class extends Base { d() { return this.id(); } };
function inFn() {
  class InDecl extends ns.Base { e() { return this.id(); } }
  const InExpr = class extends ns.Base { f() { return this.id(); } };
  const InPlain = class extends Base { g() { return this.id(); } };
  class InPlainDecl extends Base { h() { return this.id(); } }
  return [new InDecl().e(), new InExpr().f(), new InPlain().g(), new InPlainDecl().h()];
}
function makeClass(Sup) { return class extends Sup { k() { return this.id(); } }; }
const Made = makeClass(Base);
function main() {
  new TopDecl().a(); new TopExpr().b(); new TopExprNamed().c(); new TopPlain().d(); inFn(); new Made().k();
  const Cond = process.env.NOPE ? ns.Base : ns.Other; class CondSub extends Cond { m() { return this.id(); } } new CondSub().m();
}
main();
