// fixture: cjs/commonjs/circular-b.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The other half. The require of a is deferred into the function body precisely
// so it observes a fully populated module.exports. Same syntax as any other
// nested require; different reason, and the reason is not in the syntax.

'use strict';

module.exports.name = 'b';

module.exports.describe = function describe() {
  const a = require('./circular-a');
  return 'b knows ' + a.name;
};
