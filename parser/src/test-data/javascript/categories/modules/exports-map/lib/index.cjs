// fixture: exports-map/lib/index.cjs
// module system: CommonJS by extension  (package "type" is "module";
//   moduleSystemSource = EXT_CJS)
// nature: runtime-bearing
// syntax floor: ES2015
//
// The "require" condition target of the same "." export. Note the subpath
// import below uses the require spelling of the SAME "#internal/log" imports-map
// entry, which resolves through the "default" condition here.

'use strict';

const { open } = require('#internal/log');

function createLogger(name) {
  return open(name);
}

module.exports = createLogger;
module.exports.createLogger = createLogger;
module.exports.condition = 'require';
