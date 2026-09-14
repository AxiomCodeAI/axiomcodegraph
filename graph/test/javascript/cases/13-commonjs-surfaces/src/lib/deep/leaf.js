'use strict';
const { fromIndex } = require('../dir');
const impl = require('../impl');
const { helper: h } = require('../impl');
const { nested: { inner } } = require('../multi');
function leaf() { fromIndex(); h(); inner.deep(); return new impl().run(); }
module.exports = leaf;
