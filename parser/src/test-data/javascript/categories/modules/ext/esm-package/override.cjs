// fixture: ext/esm-package/override.cjs
// module system: CommonJS BY EXTENSION, inside an ESM package
//   governing: staging/ext/esm-package/package.json, "type": "module"
//   moduleSystemSource = EXT_CJS — the extension wins outright over the
//   package's "type", and there is no contradiction: this file is correct.
// nature: runtime-bearing, and it runs.
// syntax floor: ES2015
//
// The pair (this file, plain.js in the same directory) is the point. Same
// directory, same package.json, two different module systems, decided by three
// characters of file name. A parser that reads one config per run gets one of
// them wrong; §9 of BUILDING-A-PARSER.md is this case.
//
// Grounded in the .cjs shim every dual package ships.

'use strict';

const { EOL } = require('os');

module.exports = function shim(text) {
  return String(text).split(EOL);
};

module.exports.moduleSystem = 'commonjs-by-extension';
