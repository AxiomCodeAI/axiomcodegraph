// The closure is a function DECLARED inside the wrapper and returned by name,
// with enough callers to put the wrapper over the parameter fan cap.
const memoize = require("./memoize");
const AlphaPlugin = require("./alpha");
const BetaPlugin = require("./beta");

function onceDecl(fn) {
  let r;
  function inner() { if (!r) r = fn(); return r; }
  return inner;
}
// CONTROL: a declared closure that calls its parameter but returns something else.
class Mark { markOnly() { return 4; } }
function tapDecl(g) {
  function inner() { g(); return new Mark(); }
  return inner;
}
// CONTROL: a function declared OUTSIDE the wrapper, returned by name.
function shared() { return new Mark(); }
function pickShared(fn) { fn(); return shared; }

const declAlpha = onceDecl(() => new AlphaPlugin());
const declBeta = onceDecl(() => new BetaPlugin());
const getAlpha = memoize(() => new AlphaPlugin());
const declOfGetter = onceDecl(getAlpha);
const tappedDecl = tapDecl(() => new AlphaPlugin());
const picked = pickShared(() => new BetaPlugin());

function declared() {
  declAlpha().run();
  declBeta().run();
  declOfGetter().run();
  tappedDecl().markOnly();
  picked().markOnly();
}

const d01 = onceDecl(() => 1); const d02 = onceDecl(() => 2); const d03 = onceDecl(() => 3);
const d04 = onceDecl(() => 4); const d05 = onceDecl(() => 5); const d06 = onceDecl(() => 6);
const d07 = onceDecl(() => 7); const d08 = onceDecl(() => 8); const d09 = onceDecl(() => 9);
const d10 = onceDecl(() => 10); const d11 = onceDecl(() => 11); const d12 = onceDecl(() => 12);
const d13 = onceDecl(() => 13); const d14 = onceDecl(() => 14); const d15 = onceDecl(() => 15);
const d16 = onceDecl(() => 16); const d17 = onceDecl(() => 17); const d18 = onceDecl(() => 18);
const d19 = onceDecl(() => 19); const d20 = onceDecl(() => 20); const d21 = onceDecl(() => 21);
const d22 = onceDecl(() => 22); const d23 = onceDecl(() => 23); const d24 = onceDecl(() => 24);
const d25 = onceDecl(() => 25); const d26 = onceDecl(() => 26); const d27 = onceDecl(() => 27);

module.exports = { declared, d01, d02, d03, d04, d05, d06, d07, d08, d09, d10, d11, d12, d13,
  d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27 };
