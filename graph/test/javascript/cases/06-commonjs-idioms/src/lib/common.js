'use strict';
var common = exports;
exports.clone = function clone(obj) { return Object.assign({}, obj); };
exports.longest = function longest(xs) { return common.clone(xs); };
common.both = function () { exports.clone({}); common.longest([]); return module.exports.clone(1); };
