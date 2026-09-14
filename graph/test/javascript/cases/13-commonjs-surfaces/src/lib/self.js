'use strict';
function one() { return 'one'; }
function two() { return module.exports.one() + exports.one(); }
module.exports.one = one;
module.exports.two = two;
module.exports.three = () => this.one;
