// fixture: exports-map/lib/stream.node.cjs
// module system: CommonJS by extension
// nature: runtime-bearing
// syntax floor: ES2015

'use strict';

const { Readable } = require('stream');

exports.toStream = function toStream(chunks) {
  return Readable.from(chunks);
};
exports.target = 'node-cjs';
