'use strict';
const P = require('./lib/p');
function main() {
  const x = new P.X();
  x.both(); x.shadow(P.helper); x.shadowLocal(); x.inner(); x.viaFnExpr([1]); x.viaFnExprUnbound([1]); x.viaArrow([1]); x.builtins();
  new P.Z().run(); P.keys(); P.polymorphic(true); P.polymorphic(false); P.identityFlow();
  P.callMutable(); P.rebind(); P.callMutable(); P.callRegistry(); P.withThisArg([1]); P.ctorName(); P.protoCall(); P.nestedSameName();
}
main();
