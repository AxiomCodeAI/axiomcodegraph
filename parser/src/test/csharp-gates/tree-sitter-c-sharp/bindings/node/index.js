const binding = require('node-gyp-build')(require('path').join(__dirname, '..', '..'));
try { binding.nodeTypeInfo = require('../../src/node-types.json'); } catch (_) {}
module.exports = binding;
