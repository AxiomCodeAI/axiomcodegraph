// fixture: categories/jsdoc/this-annotation.js
// nature: runtime-bearing
// JsTypeReferenceContextKind.THIS — declared as "@this {T}, the receiver's
// declared type, which nothing else can state", and emitted zero times.
//
// This is the one JSDoc tag with no other channel. A parameter type has @param, a
// return has @returns, a field has @type — all three emit js_type_reference rows
// with contextKind PARAM / RETURN / FIELD. The receiver of a plain function has
// only @this, and in the prototype-era code where `this` is genuinely ambiguous
// it is the only declaration of the receiver's type anywhere in the program.
//
// The controls are in this file on purpose: @param and @returns on the SAME
// function do emit, so a run that shows PARAM and RETURN and no THIS is showing
// the tag and not the file.
//
// module system: CommonJS, governed by categories/package.json.
'use strict';

/**
 * @param {string} name
 * @returns {string}
 */
function Widget(name) { this.name = name; return name; }

/**
 * @this {Widget}
 * @param {string} suffix
 * @returns {string}
 */
function render(suffix) { return this.name + suffix; }

/** @this {Widget} */
function bareThis() { return this.name; }

Widget.prototype.render = render;
Widget.prototype.bareThis = bareThis;

module.exports = { Widget };
