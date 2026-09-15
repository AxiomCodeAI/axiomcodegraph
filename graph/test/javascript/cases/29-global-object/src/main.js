'use strict';
require('./setup');
function g1() { return globalThis.gHelper(); }
function g2() { return global.gOther(); }
function g3() { return gHelper(); }
function g4() { return globalThis.gThird(); }
function g5() { return globalThis.registry.run(); }
function g6() { return registry.run(); }
function g7() { return globalThis.setTimeout(() => gOther(), 0); }
function g8() { const g = globalThis; return g.gHelper(); }
function g9() { return global.process.cwd(); }
function main() { g1(); g2(); g3(); g4(); g5(); g6(); g7(); g8(); g9(); }
main();
