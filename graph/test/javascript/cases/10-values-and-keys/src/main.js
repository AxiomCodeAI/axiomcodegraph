'use strict';
const V = require('./lib/values');
function main() {
  V.ternary(true); V.ternary(false); V.logicalOr(null); V.logicalOr(V.a); V.nullish(undefined); V.nullish(V.b); V.logicalAnd(true);
  V.reassigned(true); V.reassigned(false); V.reassignedTwice(); V.sequence(); V.paren(); V.nestedObject();
  V.spreadLiteral(); V.assignedCopy(); V.frozen(); V.defined(); V.arrays(); V.destructure(); V.closures(); V.currying();
  V.optional(V.base, V.a); V.optional({ m: V.b, n: V.c }, undefined); V.counters(); V.callsReturned(); V.conditionalCall(true); V.conditionalCall(false); V.withArgs(); V.hofs();
}
main();
