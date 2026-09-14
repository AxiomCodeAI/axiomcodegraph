'use strict';
const C = require('./lib/classes');
async function main() {
  // static inheritance & new this
  C.Leaf.make().id(); C.Mid.make().id(); C.Leaf.register(new C.Leaf()); C.Base.describeAll(); C.Leaf.shared();
  const l = new C.Leaf(); l.bump(); l.chain().chain().id(); l.svc.run(); l.svc = new C.Service(); l.viaPrivate();
  for (const v of l) { String(v); }
  [...l].length;
  // mixins & computed extends
  new C.Mixed().own(); new C.Mixed().mixed(); new C.Mixed().id(); new C.Picked().pick(); new C.Picked().id();
  // legacy
  const s = new C.Sub(); s.get(); s.extra(); const s2 = Reflect.construct(C.Sub, []); s2.get();
  new C.ReturnsObject().m();
  C.Singleton.get().run(); C.Singleton.instance.run();
  new C.Holder(new C.Service()).go();
  C.Container.inst.run();
  new C.Late().late(); C.Late.staticLate().late();
  (await new C.AsyncCls().load()).run(); (await C.AsyncCls.build()).load(); C.AsyncCls.build().then((a) => a.load());
  new C.Accessors().pair.run();
  new C.Nested().outer();
  new C.WithNewTarget().who();
  C.Fluent.c().a().b().a();
  const Anon = class extends C.Base { id() { return 'anon'; } }; new Anon().id(); new Anon().chain().id();
  const K = C.Mixin(C.Service); new K().mixed();
  const inst = new (C.Fluent)(); inst.a();
  const Bound = C.Holder.bind(null, new C.Service()); new Bound().go();
}
main();
