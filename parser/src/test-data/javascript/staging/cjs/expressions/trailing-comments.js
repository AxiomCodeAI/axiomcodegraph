// fixture: cjs/expressions/trailing-comments.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// A TRAILING COMMENT INSIDE A BRACKETED CONSTRUCT versus the same comment after
// a statement. js-corpus reports the statement-position comment emits a
// js_comment row and the bracketed one does not.
//
// MEASURED at a5f6aab, with every comment carrying a unique TRAIL-nn marker:
// 25 in source, 15 emitted, **10 missing — and every missing one follows a
// COMMA.** TRAIL-02/03 (array), 06/07 (object), 10/11 (parameter), 14/15
// (argument), 17 (pattern), 23 (block-comment form). Every last-element comment
// with NO comma after it — TRAIL-04, 08, 12, 16, 18, 24 — survives. So the
// defect is not "inside a bracketed construct"; it is "trailing a comma", which
// is a single token and a single place to look.
//
// The same comment text is used in every position, so a missing row is
// attributable to the POSITION and to nothing else. Each is paired: the
// bracketed form, then the statement form it must match. Every comment carries a
// unique marker so a row can be matched by name and an absence named.

'use strict';

// --- the control: after a statement, which emits ---------------------------------------

const afterStatement = 1; // TRAIL-01 after a statement

// --- after an ARRAY ELEMENT -------------------------------------------------------------

const array = [
  1, // TRAIL-02 after an array element, more elements follow
  2, // TRAIL-03 after an array element, trailing comma follows
  3 // TRAIL-04 after the last element, no comma
];
const arrayControl = 4; // TRAIL-05 the statement form of the above

// --- after an OBJECT PROPERTY -------------------------------------------------------------

const object = {
  a: 1, // TRAIL-06 after a property, more follow
  b: 2, // TRAIL-07 after a property, trailing comma follows
  c: 3 // TRAIL-08 after the last property, no comma
};
const objectControl = 5; // TRAIL-09 the statement form of the above

// --- after a PARAMETER ------------------------------------------------------------------------

function parameters(
  first, // TRAIL-10 after a parameter
  second, // TRAIL-11 after a parameter, trailing comma follows
  third // TRAIL-12 after the last parameter
) {
  return first + second + third; // TRAIL-13 after a return statement — the statement form
}

// --- after an ARGUMENT --------------------------------------------------------------------------

const called = parameters(
  1, // TRAIL-14 after an argument
  2, // TRAIL-15 after an argument
  3 // TRAIL-16 after the last argument
);

// --- after a DESTRUCTURING ELEMENT and a class member ------------------------------------------------

const {
  a, // TRAIL-17 after an object-pattern element
  b // TRAIL-18 after the last pattern element
} = object;

class Members {
  method() { return 1; } // TRAIL-19 after a class method
  other() { return 2; } // TRAIL-20 after the last class method
}

// --- inside a bracketed construct but on its OWN line, not trailing anything --------------------------

const ownLine = [
  // TRAIL-21 a leading comment inside the brackets
  1,
  // TRAIL-22 between elements
  2
];

// --- block-comment form in the same positions, so the kind is not the variable -----------------------------

const blockForm = [
  1, /* TRAIL-23 block comment after an element */
  2 /* TRAIL-24 block comment after the last element */
];
const blockControl = 6; /* TRAIL-25 block comment after a statement */

module.exports = {
  afterStatement, array, arrayControl, object, objectControl, parameters,
  called, a, b, Members, ownLine, blockForm, blockControl
};
