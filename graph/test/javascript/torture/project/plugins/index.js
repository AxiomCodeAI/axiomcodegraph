'use strict';
// ── module graph: re-exports, exports mutated after module.exports, module.exports = function with props ──
const shapes = require('../lib/shapes');
module.exports = function makePlugin(name) { return { name, run: () => shapes.Shape.create(name) }; };
module.exports.shapes = shapes;
module.exports.functional = require('../lib/functional');
module.exports.late = function late() { return module.exports.functional.inc(1); };
// `exports` still names the ORIGINAL object after `module.exports =` was reassigned, so
// this is NOT reachable as makePlugin.orphan — a torture for the export table.
exports.orphan = function orphan() { return 0; };
