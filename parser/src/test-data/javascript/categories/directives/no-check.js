// @ts-nocheck
// fixture: cjs/directives/no-check.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The other half of the pair. @ts-nocheck must be the FIRST comment in the file
// to take effect, which is why it precedes this header rather than following it —
// moving it three lines down silently disables it, and nothing reports that.
//
// Under the oracle's `checkJs: true` this file yields zero diagnostics no matter
// what it contains. The JSDoc below contradicts the code exactly as
// jsdoc/contradicting-jsdoc.js does, and the difference is that here the
// contradiction is DECLARED UNCHECKED. A fact base that cannot tell the two
// files apart is asserting that one of them was verified.

'use strict';

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return a.concat(b);
}

module.exports = { add };
