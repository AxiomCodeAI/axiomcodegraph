'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("plugins/index.js:1:1");
// ── module graph: re-exports, exports mutated after module.exports, module.exports = function with props ──
const shapes = require('../lib/shapes');
module.exports = function makePlugin(name) {
    return __axiom.run("plugins/index.js:4:18", () => {
        return { name, run: () => {
                return __axiom.run("plugins/index.js:4:66", () => {
                    return shapes.Shape.create(name);
                });
            } };
    });
};
module.exports.shapes = shapes;
module.exports.functional = require('../lib/functional');
module.exports.late = function late() {
    return __axiom.run("plugins/index.js:7:23", () => {
        return module.exports.functional.inc(1);
    });
};
// `exports` still names the ORIGINAL object after `module.exports =` was reassigned, so
// this is NOT reachable as makePlugin.orphan — a torture for the export table.
exports.orphan = function orphan() {
    return __axiom.run("plugins/index.js:10:18", () => {
        return 0;
    });
};

__axiom.exit(__p);
