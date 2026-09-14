// fixture: cjs/commonjs/circular-a.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Half of a require cycle. a requires b at the top; b requires a lazily, inside
// a function, which is the standard way the cycle is made to work rather than
// to deadlock. At the moment b's top-level code runs, `require('./circular-a')`
// returns a PARTIALLY POPULATED module.exports — which is why the export
// assignment here comes before the require, and why moving it would break the
// program without changing any parser-visible structure.

'use strict';

// Exported first, on purpose. See above.
module.exports.name = 'a';

const b = require('./circular-b');

module.exports.callB = function callB() {
  return b.describe();
};

module.exports.describe = function describe() {
  return 'a knows ' + b.name;
};
