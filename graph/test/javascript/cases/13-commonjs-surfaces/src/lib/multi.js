'use strict';
function a() { return 'a'; }
function b() { return 'b'; }
exports.a = exports.b = a;
exports.c = b;
module.exports.d = function d() { return 'd'; };
Object.defineProperty(exports, 'e', { value: b, enumerable: true });
Object.defineProperty(exports, 'lazy', { get() { return b; }, enumerable: true });
exports.nested = { inner: { deep: a } };
exports.Klass = class Klass { m() { return 'km'; } };
exports.arrow = () => a();
if (process.env.NOPE) { exports.cond = a; } else { exports.cond = b; }
