// A qualifier-less import() in a JSDoc type (#631): the JSDoc-typed CommonJS idiom
// for "the class that file exports", beside the qualified control.
/** @typedef {import("./Module")} Module */
/** @typedef {import("./Module").default} ModuleDefault */
/** @typedef {import("./RuntimeTemplate")} RuntimeTemplate */
/** @typedef {import("./surface")} Surface */
/** @typedef {import("./esm.mjs")} Esm */
/** @typedef {import("./esm.mjs").Widget} Widget */

/** @param {Module} m */
function viaBare(m) { return m.identifier(); }
/** @param {ModuleDefault} m */
function viaDefault(m) { return m.identifier(); }
/** @param {import("./Module")} m */
function viaInline(m) { return m.identifier(); }
/** @param {RuntimeTemplate} rt */
function viaTemplate(rt) { return rt.basicFunction('a'); }
/** @param {Surface} s */
function viaSurface(s) { return s.run(); }
/** @param {Esm} e */
function viaEsm(e) { return e.default; }
/** @param {Widget} w */
function viaWidget(w) { return w.render(); }
module.exports = { viaBare, viaDefault, viaInline, viaTemplate, viaSurface, viaEsm, viaWidget };
