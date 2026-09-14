// fixture: cjs/jsdoc/satisfies-and-unknown-syntax.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The tail of the JSDoc vocabulary, and the dialect problem.
//
// @satisfies is the newest tag and the one with the fewest implementations: it
// checks a value against a type WITHOUT widening it to that type. Its JSDoc
// spelling exists only in TypeScript's dialect.
//
// referenceKind = UNKNOWN_SYNTAX is the deliberate escape hatch, and the second
// half of this file is what it is for. JSDoc type syntax is NOT STANDARDISED:
// Closure, TypeScript and jsdoc.app each accept things the others reject, and a
// type expression the parser cannot decompose gets ONE row with its text
// preserved rather than a guess or a dropped tag. js_parse_gap.gapKind =
// UNKNOWN_JSDOC_SYNTAX records that it happened.

'use strict';

/**
 * @satisfies on a variable. The value keeps its literal type; the tag only
 * asserts it is assignable.
 *
 * @satisfies {Record<string, string>}
 */
const routes = {
  home: '/',
  users: '/users'
};

/**
 * @satisfies in the inline-cast position, which is where TypeScript's
 * `expr satisfies T` lands in JavaScript.
 */
const config = /** @satisfies {import('./typedef-only.js').Header} */ ({
  name: 'content-type',
  value: 'application/json'
});

/**
 * @enum: Closure's constant set. The members are the annotated object's
 * properties, so the type's members live in a VALUE and its declaration lives
 * in a comment.
 *
 * @enum {number}
 * @readonly
 */
const StatusCode = {
  OK: 200,
  NOT_FOUND: 404,
  ERROR: 500
};

/**
 * @const with a type, @default, @overload, @package / @protected / @public —
 * the access tags, none of which JavaScript enforces.
 *
 * @const {string}
 * @default
 */
const VERSION = '1.0.0';

/**
 * @overload declares an extra signature. There is exactly one function here and
 * the comments claim three, which is the JSDoc spelling of an overload set —
 * and unlike TypeScript's, nothing checks that the implementation covers them.
 *
 * @overload
 * @param {string} value
 * @returns {string}
 *
 * @overload
 * @param {number} value
 * @returns {number}
 *
 * @param {string|number} value
 * @returns {string|number}
 */
function identity(value) { return value; }

// --- the dialect boundary: syntax a parser may not be able to decompose --------

/**
 * Closure's non-nullable/nullable prefixes combined with generics and a
 * function type carrying `new:` — the constructor-signature spelling, which
 * TypeScript's JSDoc parser does not accept.
 *
 * @param {function(new:Date, number)} ctor
 * @param {!Array<?string>} mixed
 * @returns {undefined}
 */
function closureOnly(ctor, mixed) { return undefined; }

/**
 * Closure's record type with a trailing comma and its `=` optional-suffix
 * spelling, which is different from the `[name]` spelling used elsewhere in
 * this fixture set.
 *
 * @param {{a: number, b: string,}} trailingComma
 * @param {string=} suffixOptional
 * @param {...!Object} restOfObjects
 */
function closureRecord(trailingComma, suffixOptional, restOfObjects) {}

/**
 * A conditional type and a mapped type in JSDoc. Both are TypeScript-only, both
 * are legal in a @typedef, and neither is decomposable by a Closure-shaped
 * parser.
 *
 * @typedef {T extends string ? number : boolean} Conditional
 * @template T
 */

/**
 * @typedef {{ [K in keyof T]: string }} Mapped
 * @template T
 */

/**
 * A template-literal type, and an indexed access.
 *
 * @typedef {`on${Capitalize<string>}`} EventName
 * @typedef {StatusCode[keyof StatusCode]} StatusValue
 */

/**
 * Genuinely malformed. An unbalanced brace, an empty type, and a type that is
 * a bare sentence. Each should produce one UNKNOWN_SYNTAX row with the text
 * preserved and a parse gap beside it — NOT a dropped tag and not a guess.
 *
 * @param {Array<string} unbalanced
 * @param {} empty
 * @param {a number, probably} prose
 * @returns {
 */
function malformed(unbalanced, empty, prose) { return null; }

/**
 * A tag nobody has ever heard of, carrying a type. Unknown TAG names are a
 * different problem from unknown type SYNTAX, and the two must not be conflated:
 * this type expression is perfectly well formed.
 *
 * @customtag {Array<number>} something
 * @param {string} x
 */
function unknownTag(x) { return x; }

/**
 * An inline {@link} and {@linkcode} inside a description, which are text
 * markup, not types — a parser that harvests every brace pair as a type
 * expression finds two here that are not.
 *
 * @param {string} x see {@link identity} and {@linkcode closureOnly}
 */
function inlineLinks(x) { return x; }

// A line comment with a tag in it. Not JSDoc: JSDoc is a /** */ block, and
// @param here is prose.
// @param {string} notJsdoc

/* A block comment that is not JSDoc — two stars are required, this has one.
   @type {number} */
const notAnnotated = 1;

module.exports = {
  routes, config, StatusCode, VERSION, identity,
  closureOnly, closureRecord, malformed, unknownTag, inlineLinks, notAnnotated
};
