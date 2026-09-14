// fixture: cjs/methods/pattern-binding-paths.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (object rest in a parameter pattern)
//
// DISCRIMINATORS FOR THE BINDING-PATH COLUMN on the reference row.
//
// `resolvedParameterLinkHash` (c33) identifies WHICH PARAMETER a reference
// resolves to, and for a destructured parameter that is not enough: in
// `f({ a, b })` the references to `a` and to `b` resolve to the same single
// parameter row, so c33 is identical for both and the fact base cannot say which
// bound name was read. The path column is what separates them.
//
// **Every bound name below is referenced in the body**, deliberately — the path
// rides on the REFERENCE row, so a name that is bound and never read produces no
// row to carry it and tests nothing.
//
// ## The premise this file does NOT rest on
//
// I previously wrote that a destructured parameter mints "one parameter row plus
// N `js_variable` rows". **That is wrong.** `emitVariables()` skips every
// PARAMETER-regime binding, so **no parameter mints a `js_variable` row at all**,
// simple or destructured — verified: `js_variable.bindingRegime = PARAMETER`
// counts **0** corpus-wide. The schema said otherwise and the emitter was right.
// So the bound names of a pattern exist in the fact base ONLY as references, and
// the path column is the only thing that will ever name them.
//
// ## What the path has to express
//
// A path is the route from the parameter to the bound name. The cases below are
// ordered by what makes each one hard, and the last three are the ones where a
// path may not exist at all.

'use strict';

// --- 1. flat object pattern: the path is the key ------------------------------------

function flat({ alpha, beta }) {
  return alpha + beta;                          // paths: "alpha", "beta"
}

// --- 2. RENAMED: the reference and the path are different strings ---------------------
//
// The reference reads `local`; the path is `wire`. A path column that records
// the identifier rather than the key gets every renamed binding wrong, and
// renaming is how a wire format is adapted to a codebase's naming.

function renamed({ wire: local, 'kebab-key': kebab, 0: numeric }) {
  return local + kebab + numeric;               // paths: "wire", "kebab-key", "0"
}

// --- 3. NESTED: the path is a route, not a key ------------------------------------------

function nested({ outer: { inner } }) {
  return inner;                                 // path: "outer.inner"
}

function nestedThreeDeep({ a: { b: { c } } }) {
  return c;                                     // path: "a.b.c"
}

function nestedAndRenamed({ req: { body: { userId: id } } }) {
  return id;                                    // path: "req.body.userId"
}

// --- 4. DEFAULTS inside patterns ----------------------------------------------------------
//
// A default does not change the path — `port` is still read from key `port`.
// It does add an expression that runs only when the key is absent, and a default
// that REFERENCES AN EARLIER BINDING OF THE SAME PATTERN is the case where the
// path and the scope interact.

function defaults({ host = 'localhost', port = 80 }) {
  return host + ':' + port;                     // paths: "host", "port"
}

function defaultUsesSibling({ base, full = base + '/api' }) {
  return full;                                  // "full", whose default reads "base"
}

function nestedDefault({ opts: { retries = 3 } = {} }) {
  return retries;                               // path: "opts.retries"
}

// --- 5. REST in an object pattern -----------------------------------------------------------
//
// `others` has no key of its own. Its path is not a route to a property — it is
// "every enumerable own key NOT named above", which is a complement rather than
// a path, and the set is not knowable from this file. Whether the column records
// "" , a sentinel, or something else is the question; what it must not do is
// record `others`, which is the local name and not a key.

function objectRest({ known, ...others }) {
  return known + Object.keys(others).length;    // "known"; and what for `others`?
}

// --- 6. ARRAY patterns: the path is an INDEX -------------------------------------------------

function arrayFlat([first, second]) {
  return first + second;                        // paths: "0", "1"
}

// A HOLE shifts every subsequent index. `third` is at index 2, not 1 — an
// implementation that counts emitted bindings rather than element positions
// gets this wrong and gets it wrong silently.
function arrayHole([, , third]) {
  return third;                                 // path: "2"
}

// Rest in an array pattern: `tail` is indices 1 onward, another complement.
function arrayRest([head, ...tail]) {
  return head + tail.length;                    // "0"; and what for `tail`?
}

// --- 7. MIXED: object inside array inside object ------------------------------------------------
//
// The two path alphabets meet. `deep`'s route is a key, then an index, then a
// key — so a path column typed as "a dotted list of identifiers" cannot hold it,
// and one typed as "a list of steps" can.

function mixed({ rows: [{ cell }] }) {
  return cell;                                  // path: "rows.0.cell"
}

function arrayOfObjects([{ id }, { id: secondId }]) {
  return id + secondId;                         // paths: "0.id", "1.id"
}

function deeplyMixed({ a: [{ b: [c] }] }) {
  return c;                                     // path: "a.0.b.0"
}

// --- 8. paths syntax cannot fix ----------------------------------------------------------------

// 8a. A COMPUTED key. The path is the value of `keyName` at call time, which is
//     not in this file. This is the `require(variable)` of binding paths: the
//     honest answer names nothing rather than guessing `keyName`.
const keyName = 'chosen';
function computedKey({ [keyName]: picked }) {
  return picked;                                // path: NOT knowable from syntax
}

// 8b. A computed key built from an expression.
function computedExpression({ ['pre' + 'fix']: joined }) {
  return joined;                                // constant-foldable, and still computed
}

// 8c. A symbol key. Not a string at all.
const TAG = Symbol('tag');
function symbolKey({ [TAG]: tagged }) {
  return tagged;
}

// --- 9. the controls ------------------------------------------------------------------------------
//
// A SIMPLE parameter has no path. If the column is populated for `plain` below,
// it is being filled where there is nothing to fill it with.

function simpleParameter(plain) {
  return plain;                                 // path: none — not a pattern
}

function defaultedSimple(withDefault = 1) {
  return withDefault;                           // path: none
}

function restSimple(...args) {
  return args.length;                           // path: none — a rest PARAMETER,
                                                // not a rest element in a pattern
}

// A destructured VARIABLE rather than a parameter — same syntax, and it is a
// `js_variable` because it is not a parameter, so the path column on its
// references is a different question with the same shape.
function destructuredLocal(source) {
  const { alpha: renamedLocal, nested: { deep } } = source;
  return renamedLocal + deep;
}

module.exports = {
  flat, renamed, nested, nestedThreeDeep, nestedAndRenamed,
  defaults, defaultUsesSibling, nestedDefault, objectRest,
  arrayFlat, arrayHole, arrayRest, mixed, arrayOfObjects, deeplyMixed,
  computedKey, computedExpression, symbolKey,
  simpleParameter, defaultedSimple, restSimple, destructuredLocal
};
