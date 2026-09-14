// The @import JSDoc tag (TypeScript 5.5+), the replacement for @typedef {import(...)}.
// Every binding form, beside the older spelling as the control (#621).
/** @import RuntimeTemplate from "./tpl" */
/** @import { Parser, Other as Renamed } from "./named" */
/** @import * as Named from "./named" */
/** @typedef {import("./named").Parser} ParserAlias */

/** @param {RuntimeTemplate} rt */
function viaImportDefault(rt) { return rt.basicFunction('a'); }
/** @param {Parser} p */
function viaImportNamed(p) { return p.getLocation('b'); }
/** @param {Renamed} o */
function viaImportRenamed(o) { return o.other(); }
/** @param {ParserAlias} p */
function viaTypedef(p) { return p.getLocation('c'); }
// A qualified name through the namespace binding: the row exists; resolving a
// dotted type name through a namespace import is a separate gap, for runtime
// `import * as` too. Pinned so a change is visible.
/** @param {Named.Parser} p */
function viaNamespace(p) { return p.getLocation('d'); }
module.exports = { viaImportDefault, viaImportNamed, viaImportRenamed, viaTypedef, viaNamespace };
