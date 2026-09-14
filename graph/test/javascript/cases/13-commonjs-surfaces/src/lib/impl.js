'use strict';
class Impl { run() { return 'impl'; } static make() { return new Impl(); } }
function helper() { return 'helper'; }
module.exports = Impl;
module.exports.helper = helper;
