'use strict';
const D = require('./lib/doc');
const { Widget, Gadget } = require('./lib/types');
async function main() {
  const w = new Widget(), g = new Gadget();
  D.union(w); D.union(g); D.nullable(w); D.optional(w); D.bracketOptional(w); D.arr([w]); D.arr2([w]); D.record({ key: w, other: w }); D.objMap({ key: w });
  D.map(new Map([['k', w]])); D.set(new Set([w])); await D.promise(Promise.resolve(w)); (await D.returnsPromise()).run(); D.returnsPromise().then((x) => x.run());
  D.importType(w); D.optionsType({ widget: w, onDone: (x) => x.run() }); D.qualified(g); D.inlineShape(w); D.fnType((x) => x.run()); D.tsFnType((x) => x.run()); D.thisTyped.call(w);
  D.typedVars(); D.generics();
  const d = new D.Doc(); d.widget = w; d.use(); d.widget.run();
  new D.Ext().extra(); new D.Aug().extra(); new D.Impl().run(); new D.Ctor().get(); new D.Sub2().extra2(); new D.Sub3().extra3(); D.E.A;
}
main();
