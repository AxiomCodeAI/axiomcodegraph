// fixture: cjs/jsdoc/casts-and-throws.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// DISCRIMINATORS FOR `JsTypeReferenceContextKind.CAST` AND `THROWS`, written
// ahead of the append. js-corpus found 1,942 inline JSDoc casts with no context
// kind to be emitted under.
//
// ## The distinction the CAST ruling has to make, and both halves are here
//
// TypeScript's JSDoc cast is the PARENTHESISED form only:
//
//     /** @type {T} */ (expr)          <- a type assertion on `expr`
//
// Without the parentheses the same comment is, to TypeScript, a comment that
// happens to precede an expression — it asserts nothing. But the unparenthesised
// form is what the 1,942 mostly ARE (`/** @type {NoticeFunction} */ data => …`),
// because authors write it and nothing tells them it does nothing. So the ruling
// has to say whether CAST records the parser's semantics (parentheses required)
// or the author's intent (any @type immediately before an expression). Both
// forms sit side by side below so that whichever is chosen, the other one is the
// control.
//
// ## Measured before the append, at a5f6aab
//
// The file produces nine js_type_reference rows and NONE of them is a cast:
// VARIABLE/type x2 (the two controls, correctly), FIELD/type x1, PARAM x2,
// RETURN x1, TYPEDEF x2. The nine cast sites produce nothing, the four @throws
// produce nothing, and `paramAnnotated`'s @type on a parameter produces nothing
// either. That is the before-state the append is measured against: the controls
// must stay VARIABLE, and the nine casts must become CAST or the ruling must say
// which of them do not.
//
// ## The trap, avoided on purpose
//
// This header is written WITHOUT any `/** */` block, because a JSDoc block in a
// header that mentions a tag in prose is read by the parser as that tag. The
// only `/** */` comments in this file are the ones under test.

'use strict';

const raw = JSON.parse('{}');
const items = [1, 2, 3];

/**
 * @typedef {Object} Notice
 * @property {string} text
 */

/**
 * @callback NoticeFunction
 * @param {Notice} data
 * @returns {string}
 */

// --- 1. the cast proper: parenthesised ----------------------------------------------

const asBanner = /** @type {Notice} */ (raw);

// A cast of a call result, and of a member access.
const fromCall = /** @type {Notice} */ (JSON.parse('{"text":"x"}'));
const fromMember = /** @type {string} */ (raw.text);

// --- 2. a cast on an ARROW passed as an argument — the 1,942 case, both forms ---------

// 2a. Parenthesised: a cast, unambiguously.
const parenthesisedArrow = items.map(/** @type {NoticeFunction} */ ((data) => data.text));

// 2b. NOT parenthesised: this is what the corpus actually contains. To TypeScript
//     the @type asserts nothing; to the author it is a cast. One of these two
//     lines is a CAST row and the other is the control — which is which is the
//     ruling.
const bareArrow = items.map(/** @type {NoticeFunction} */ (data) => data.text);

// 2c. The same, with the comment INSIDE the parameter list rather than before it —
//     a third placement authors use, and it annotates the parameter, not the arrow.
const paramAnnotated = items.map((/** @type {Notice} */ data) => data.text);

// --- 3. a cast on an OBJECT LITERAL ------------------------------------------------------
//
// The parentheses are load-bearing twice here: they make it a cast, and they
// keep the `{` from being parsed as a block. Without them this line is a syntax
// error, which is why the object-literal cast is always parenthesised in the wild.

const literalCast = /** @type {Notice} */ ({ text: 'literal' });
const nestedLiteralCast = /** @type {{ inner: Notice }} */ ({ inner: { text: 'n' } });

// --- 4. a cast whose type DOES NOT EXIST ----------------------------------------------------
//
// Nothing declares `NeverDeclaredType`. The cast still asserts it. The parser
// emits the name as written and resolves nothing, which is the only honest row;
// a parser that drops the cast because the type is unresolvable loses the
// author's claim.

const toNothing = /** @type {NeverDeclaredType} */ (raw);

// --- 5. the CONTROLS: ordinary @type that must NOT be recorded as a cast ---------------------

// 5a. On a declaration. contextKind = VARIABLE, not CAST. The difference from §1
//     is that the comment precedes a `const`, not a parenthesised expression.
/** @type {Notice} */
const declared = raw;

// 5b. On a declaration whose initialiser is parenthesised. Still VARIABLE: the
//     comment is attached to the declaration, and the parentheses are just
//     parentheses.
/** @type {Notice} */
const parenthesisedInit = (raw);

// 5c. On a field.
class Holder {
  constructor() {
    /** @type {Notice} */
    this.banner = raw;
  }
}

// 5d. @type in a comment that precedes a STATEMENT, not an expression. Not a cast,
//     and not attached to anything the parser can type.
/** @type {Notice} */
items.push(4);

// --- 5e–5k. THE 63% — @type on a STATEMENT, where the extractor must walk one node down ----
//
// js-oracle's decomposition: only 29% of @type tags are a vocabulary gap. 63%
// attach to a VariableStatement or an ExpressionStatement and need the extractor
// to reach the declaration or expression one node beneath — vocabulary that
// already exists. So a fix that routes every unparenthesised @type to CAST
// passes the cast cases above and gets all of these wrong. Each must come out
// VARIABLE (or FIELD), never CAST, and never nothing.
//
// MEASURED at db339c1, after CAST entered the vocabulary and before any
// extractor emits it. Nine @type tags in this section; seven come out right
// today and two come out as NOTHING — and the two are the same shape:
//
//   let ret = raw;                    VARIABLE   (5e)
//   let assignedLater;                VARIABLE   (5f, no initialiser)
//   var legacy = raw;                 VARIABLE   (5g)
//   ret = JSON.parse(...);            NOTHING    (5h)  <- identifier target
//   Holder.prototype.shared = raw;    FIELD      (5i)  <- member target, walks down
//   let firstOfTwo = 1, secondOfTwo;  VARIABLE x1(5j, one row for two bindings)
//   let local = raw;                  VARIABLE   (5k, in a body)
//   local = JSON.parse('{}');         NOTHING    (5k)  <- identifier target again
//   const text = local.text;          VARIABLE   (5k)
//
// So the walk-down already works for every declaration AND for an expression
// statement whose target is a member; it fails only for an expression statement
// whose target is a bare identifier. That is the narrowest possible statement
// of the gap, and it is the shape a route-everything-to-CAST fix would grab
// first, because it is the one currently producing nothing.
//
// WHAT 5k ACTUALLY FOUND, which is not what it was written for. js-impl traced
// the silence on 5k to the identifier resolving from the MODULE scope — the walk
// was inside a function and did not know it — and from there to `scopeOfNode`
// and `scopeByNode` swapped in four places (c1a52e1). Every js_method's
// bodyScopeLinkHash had been its ENCLOSING scope since the first commit.
// Measured across this corpus: before the fix, 908 of 908 non-initializer
// methods had bodyScope === ownerScope; after it, 0 of 908. A three-line control
// written to catch a wrong fix for a narrow gap found a defect in every method
// row the parser had ever emitted.
//
// After c1a52e1: 9 of 9 tags in this section produce a row — 8 VARIABLE, 1
// FIELD. 5h and 5k now attach to the reassigned binding as VARIABLE rather than
// to the expression; whether that is the right owner is a ruling, not recorded
// here as an expectation.

// 5e. `let` with an initialiser — the case asked for by name. VARIABLE.
/** @type {Notice} */
let ret = raw;

// 5f. `let` with NO initialiser, assigned later. The declaration is still the
//     thing the comment is on. VARIABLE, and hasInitializer = false.
/** @type {Notice} */
let assignedLater;
assignedLater = raw;

// 5g. `var`, the third keyword. VARIABLE.
/** @type {Notice} */
var legacy = raw;

// 5h. An EXPRESSION STATEMENT: an assignment to a binding declared earlier. There
//     is no declaration under the comment and no parenthesised expression. The
//     node beneath is an assignment; the target is `ret`. This is the case a
//     route-everything-to-CAST fix misclassifies first.
/** @type {Notice} */
ret = JSON.parse('{"text":"reassigned"}');

// 5i. An expression statement whose target is a MEMBER. The node beneath is an
//     assignment to `Holder.prototype.shared`, which is an assignment-declared
//     field — so if anything, FIELD. Never CAST.
/** @type {Notice} */
Holder.prototype.shared = raw;

// 5j. A multi-declarator statement. One comment, two bindings. Which one carries
//     the type — the first, both, or neither — is a ruling; CAST is not an option.
/** @type {number} */
let firstOfTwo = 1, secondOfTwo = 2;

// 5k. The same shapes INSIDE a function body, so the walk-down happens under a
//     method owner rather than the module initializer.
function insideBody() {
  /** @type {Notice} */
  let local = raw;
  /** @type {Notice} */
  local = JSON.parse('{}');
  /** @type {string} */
  const text = local.text;
  return text;
}

// --- 6. @throws, getting a kind in the same append -----------------------------------------
//
// The closest JavaScript comes to Java's throws clause, and it is a comment with
// no enforcement. Three shapes: a type, a type with a description, and a
// description with no type at all — the last has no type expression to make a
// js_type_reference row from, which is the discriminator.

/**
 * @param {string} id
 * @throws {RangeError}
 * @returns {string}
 */
function throwsTyped(id) {
  if (!id) { throw new RangeError('id'); }
  return id;
}

/**
 * @param {string} id
 * @throws {TypeError} when id is not a string
 * @throws {RangeError} when id is empty
 */
function throwsTwice(id) {
  if (typeof id !== 'string') { throw new TypeError('id'); }
  if (!id) { throw new RangeError('id'); }
  return id;
}

/**
 * @throws when the input is bad
 */
function throwsUntyped(input) {
  if (!input) { throw new Error('bad'); }
  return input;
}

/**
 * @throws {NeverDeclaredError}
 */
function throwsUndeclared() {
  throw new Error('x');
}

module.exports = {
  asBanner, fromCall, fromMember, parenthesisedArrow, bareArrow, paramAnnotated,
  literalCast, nestedLiteralCast, toNothing, declared, parenthesisedInit, Holder,
  ret, assignedLater, legacy, firstOfTwo, secondOfTwo, insideBody,
  throwsTyped, throwsTwice, throwsUntyped, throwsUndeclared
};
