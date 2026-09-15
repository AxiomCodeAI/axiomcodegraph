'use strict';
// CommonJS inside an ES package: reached through createRequire and through a default import
function fromCjs() { return 'cjs'; }
class CjsThing { run() { return fromCjs(); } }
module.exports = { fromCjs, CjsThing };
module.exports.later = function later() { return new CjsThing().run(); };
