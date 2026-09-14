'use strict';
const A = require('./circ-a');
exports.fromB = function fromB() { return 'b'; };
exports.callsA = function callsA() { return A.fromA(); };
