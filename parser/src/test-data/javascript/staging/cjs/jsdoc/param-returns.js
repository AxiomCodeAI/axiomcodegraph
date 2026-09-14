// fixture: cjs/jsdoc/param-returns.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// JSDoc as the DECLARATION-SITE TYPE CHANNEL. 0.165% of parameters in the
// schema's corpus carry a syntactic annotation and 36.4% carry a JSDoc one, so
// this is where declared types actually live: @param 40,551 sites, @type 18,674,
// @returns 11,937.
//
// declaredTypeSource = JSDOC on every typed position here, and each type
// expression is a TREE in js_type_reference (contextKind = PARAM / RETURN /
// VARIABLE / FIELD), not a string.
//
// Grounded in a utility library with 73.0% JSDoc density, the highest in the
// schema's corpus, and a runtime's internal documentation comments.

'use strict';

/**
 * The plain case.
 *
 * @param {string} name
 * @param {number} times
 * @returns {string}
 */
function repeat(name, times) {
  return name.repeat(times);
}

/**
 * Optional, defaulted, rest, and a parameter whose JSDoc name does not match
 * the code's — the last one is a real and common mistake, and the parser's job
 * is to emit what is written, not to correct it.
 *
 * @param {string} required
 * @param {number} [optional]                 optional, no default
 * @param {number} [withDefault=10]           default IN THE COMMENT, and the
 *                                            code has its own default too
 * @param {...string} rest
 * @param {boolean} misnamed                  no parameter is called `misnamed`
 * @returns {void}
 */
function options(required, optional, withDefault = 10, ...rest) {
  return [required, optional, withDefault, rest];
}

/**
 * A destructured parameter. ONE js_method_parameter row with bindingForm =
 * OBJECT_PATTERN and patternBindingCount = 3, plus three js_variable rows —
 * emitting three parameter rows would break `position`, and emitting one with no
 * binding information would lose every name.
 *
 * The dotted @param names are how JSDoc describes the members of a destructured
 * object, and they are not parameters.
 *
 * @param {Object} config
 * @param {string} config.host
 * @param {number} [config.port=80]
 * @param {{ retries: number, backoff: number }} config.policy
 * @returns {string}
 */
function connect({ host, port = 80, policy: { retries } }) {
  return `${host}:${port}/${retries}`;
}

/**
 * Every type-expression shape, in parameter position.
 *
 * @param {string|number} union
 * @param {?string} nullable
 * @param {!Object} nonNullable
 * @param {*} anything
 * @param {string[]} arrayShorthand
 * @param {Array<string>} arrayGeneric
 * @param {Object<string, number>} record
 * @param {{a: number, b: string}} objectLiteralType
 * @param {function(number): string} functionType
 * @param {[string, number]} tuple
 * @param {'a'|'b'|'c'} stringLiterals
 * @param {Promise<Array<Map<string, number>>>} deepGeneric
 * @param {typeof repeat} typeofQuery
 * @param {import('./typedef-only.js').Header} importedType
 * @returns {Promise<void>}
 */
async function everyShape(
  union, nullable, nonNullable, anything, arrayShorthand, arrayGeneric,
  record, objectLiteralType, functionType, tuple, stringLiterals,
  deepGeneric, typeofQuery, importedType
) {
  return undefined;
}

/**
 * @returns with a description, @return (the singular alias), @yields, and
 * @throws — which is the closest JavaScript comes to Java's throws clause, and
 * it is a comment with no enforcement whatever.
 *
 * @param {number} n
 * @return {Generator<number, string, void>} the singular tag spelling
 * @yields {number}
 * @throws {RangeError} if n is negative
 */
function* countdown(n) {
  if (n < 0) { throw new RangeError('negative'); }
  while (n > 0) { yield n--; }
  return 'done';
}

/**
 * @this declares the receiver's type — the JSDoc equivalent of TypeScript's
 * `this` parameter, and the only way to type a prototype-assigned method's
 * receiver.
 *
 * @this {{ name: string }}
 * @returns {string}
 */
function usesThis() {
  return this.name;
}

// --- @type on variables and fields ---------------------------------------------

/** @type {number} */
let count = 0;

/** @type {Array<string>} */
const names = [];

/** @type {Map<string, {hits: number}>} */
const cache = new Map();

/** @type {function(string): boolean} */
const predicate = (s) => s.length > 0;

/** @type {?import('./typedef-only.js').Request} */
let currentRequest = null;

// @type on a destructuring declaration types the whole pattern, not one name.
/** @type {{a: number, b: number}} */
const { a, b } = { a: 1, b: 2 };

class Server {
  constructor() {
    /** @type {number} */
    this.port = 0;

    /** @type {Array<import('./typedef-only.js').Header>} */
    this.headers = [];

    /**
     * @type {function(Error): void}
     * @private
     */
    this.onError = () => {};
  }

  /**
   * @param {number} port
   * @returns {this} for chaining — `this` as a return type
   */
  listen(port) {
    this.port = port;
    return this;
  }
}

// --- an inline cast: the parenthesised @type ------------------------------------
//
// A type annotation on an EXPRESSION rather than a declaration. The comment sits
// between the open paren and the expression, and it is the only place JSDoc
// annotates something that is not a declaration.

const raw = JSON.parse('{}');
const typed = /** @type {{id: number}} */ (raw);
const asConst = /** @type {const} */ ({ mode: 'strict' });

module.exports = {
  repeat, options, connect, everyShape, countdown, usesThis,
  count, names, cache, predicate, currentRequest, a, b, Server, typed, asConst
};
