// fixture: cjs/commonjs/exports-array.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5
//
// Support module. Exists so destructured-require.js can array-destructure a
// require against something real. exportedValueKind is neither OBJECT_LITERAL
// nor FUNCTION here — it is an array literal, which is the OTHER case.

'use strict';

module.exports = [
  function first() { return 1; },
  function second() { return 2; }
];
