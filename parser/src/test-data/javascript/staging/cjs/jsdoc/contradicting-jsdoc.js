// fixture: cjs/jsdoc/contradicting-jsdoc.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// JSDoc THAT IS WRONG. Every comment in this file disagrees with the code it
// annotates, and the parser's job is to emit what is written, not to adjudicate.
//
// The rule this fixture pins: declaredTypeName comes from the comment,
// parameterCount and the parameter names come from the code, and the fact base
// records both without reconciling them. A parser that drops the JSDoc when it
// conflicts loses the author's stated intent; one that trusts the JSDoc over the
// code produces a fact base describing a program that does not exist; one that
// silently picks per case is worst of all, because the rule is then unknowable.
//
// This is not a synthetic worry. JSDoc rots the moment a signature changes and
// nothing checks it — which is precisely why it is only 36.4% present and why
// checkJs finds errors in nearly every JSDoc-typed package.

'use strict';

/**
 * The comment says two parameters; the code takes three. The comment says the
 * return is a string; the code returns a number.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function arityMismatch(a, b, c) {
  return a.length + b.length + (c || 0);
}

/**
 * The comment names parameters that do not exist and misses ones that do.
 *
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function nameMismatch(rows, columns) {
  return rows * columns;
}

/**
 * The comment says the parameter is optional; the code has no default and
 * dereferences it unconditionally, so calling it without the argument throws.
 *
 * @param {Object} [options]
 * @returns {string}
 */
function optionalityMismatch(options) {
  return options.name;
}

/**
 * The comment says the parameter is a string; every use in the body treats it
 * as an array.
 *
 * @param {string} items
 * @returns {void}
 */
function typeMismatch(items) {
  items.forEach((item) => item);
}

/**
 * The comment declares a rest parameter; the code uses `arguments` instead —
 * the second, undeclared parameter channel. usesArguments is true, hasRestParameter
 * is false, and @param says otherwise.
 *
 * @param {...number} values
 * @returns {number}
 */
function restMismatch() {
  return Array.prototype.reduce.call(arguments, (a, b) => a + b, 0);
}

/**
 * @returns on a function that returns nothing, and @yields on a function that
 * is not a generator.
 *
 * @returns {Promise<string>}
 * @yields {number}
 */
function returnsNothing() {
  // no return statement at all
}

/**
 * @async on a synchronous function, and @generator on one that does not yield.
 *
 * @async
 * @generator
 * @returns {number}
 */
function notAsync() {
  return 1;
}

/**
 * The comment says this extends EventEmitter; the code extends Error. Both are
 * in the file, they name different types, and only one of them runs.
 *
 * @extends {EventEmitter}
 */
class HeritageMismatch extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeritageMismatch';
  }
}

/**
 * @implements an interface none of whose members this class has.
 *
 * @implements {import('./typedef-only.js').Middleware}
 */
class ImplementsNothing {
  unrelated() { return true; }
}

/**
 * @type declares a number; the initialiser is a string. tsc under checkJs flags
 * this; the parser records both and flags nothing.
 *
 * @type {number}
 */
const wrongType = 'not a number';

/**
 * @type on a const that is later mutated in a way the type forbids.
 *
 * @type {ReadonlyArray<string>}
 */
const mutated = [];
mutated.push('mutation');

/**
 * @private on an exported member, and @readonly on one that is assigned twice.
 * Both tags are advisory: nothing enforces either.
 *
 * @private
 * @readonly
 * @type {number}
 */
let notReallyPrivate = 1;
notReallyPrivate = 2;

/**
 * @deprecated with a replacement that does not exist, and @see pointing at a
 * missing symbol. Reference tags with dangling targets are the norm, not the
 * exception.
 *
 * @deprecated use {@link doesNotExist} instead
 * @see NeverDeclared
 * @param {string} x
 */
function deprecated(x) { return x; }

/**
 * A comment attached to nothing. There is a blank line between it and the next
 * statement, which by JSDoc's own rules detaches it — and different tools
 * disagree about that. attachedToKind = NONE is the honest answer.
 *
 * @type {string}
 */

const unattached = 1;

/**
 * Two JSDoc comments on one declaration. The LAST one wins by convention, and
 * both are in the file.
 *
 * @param {string} first
 */
/**
 * @param {number} second
 * @returns {boolean}
 */
function twoComments(x) { return Boolean(x); }

module.exports = {
  arityMismatch, nameMismatch, optionalityMismatch, typeMismatch, restMismatch,
  returnsNothing, notAsync, HeritageMismatch, ImplementsNothing,
  wrongType, mutated, notReallyPrivate, deprecated, unattached, twoComments
};
