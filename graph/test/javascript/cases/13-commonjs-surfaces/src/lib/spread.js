'use strict';
const impl = require('./impl');
function local() { return 'local'; }
module.exports = { ...require('./dir'), local, Impl: impl, alias: local };
exports.never = function never() { return 'never'; };
