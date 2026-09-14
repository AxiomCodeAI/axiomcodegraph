// fixture: verified/jsdoc-import-type-rehosted/nested-declaration.js
// nature: runtime-bearing
//
// ONE @type comment, ONE import type, and the parser at 5095da4 mints it once per
// FUNCTION DECLARATION nested anywhere inside the documented variable's
// initializer — a duplicate js_import primary key, the first PK collision any
// tree had produced (3,589,235 development rows, 0 duplicates). Found by the
// held-back corpus on 2026-09-13; three sites, two, two and three rows each.
//
// Bisected: with only a function EXPRESSION inside the initializer the row is
// minted once; each nested function DECLARATION adds a copy. Expect exactly
// one js_import row for './x.js', at line 15 column 12, whatever the parser
// does with `inner` and `also`. Measured at 5095da4: THREE rows at 15:12.

/** @type {import('./x.js').Controller} */
const controller = {
    query(frame) {
        frame.response = async function (req, res) {
            function inner(prop, val) {
                req[prop] = val;
            }
            return res.redirect(inner);
        };
        function also() {
            return frame;
        }
        return also;
    }
};

// control: the same comment over an initializer with no nested declaration
// mints one row and must keep minting one.
/** @type {import('./y.js').Plain} */
const plain = {
    query(frame) {
        return function (req) { return [req, frame]; };
    }
};

module.exports = {controller, plain};
