// fixture: cjs/expressions/literals.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2020 (BigInt); ES2021 for numeric separators
//
// Port of java/expressions/LiteralTypeTestCases.java. js_expression.literalKind
// covers STRING | NUMBER | TEMPLATE | REGEX | NULL | UNDEFINED | BIGINT | NONE.
//
// NO ANALOGUE — Java's char literals ('a') and numeric type suffixes (1.5f,
// 999L, 0.1d). JavaScript has one number type plus BigInt, and a single-quoted
// 'a' is a string of length one, not a different kind.
//
// `undefined` is the interesting one: it is not a literal at all, it is a global
// IDENTIFIER that happens to hold undefined. `null` is a keyword and a literal.
// A parser that classifies them identically is wrong about which one can be
// shadowed.

'use strict';

// --- numbers ---------------------------------------------------------------------

const decimal = 42;
const negative = -17;                 // a unary operator applied to a literal
const float = 3.14159;
const leadingDot = .5;
const trailingDot = 5.;
const exponent = 1.5e10;
const negExponent = 2E-8;
const hex = 0xFF;
const hexUpper = 0XDEADBEEF;
const octal = 0o755;
const binary = 0b1010_1010;
const separators = 1_000_000;
const floatSeparators = 1_234.567_8;
const zero = 0;
const negativeZero = -0;
const infinity = Infinity;
const notANumber = NaN;
const maxSafe = 9007199254740991;
const beyondSafe = 9007199254740993;   // silently not representable

// BigInt: a different type, and the `n` suffix is the only one JavaScript has.
const big = 9007199254740993n;
const bigHex = 0xFFn;
const bigZero = 0n;

// --- strings -----------------------------------------------------------------------

const single = 'single quoted';
const double = "double quoted";
const withApostrophe = "it's fine";
const escaped = 'tab:\t newline:\n cr:\r backslash:\\ quote:\' null:\0 bell:\b';
const hexEscape = '\x41\x42';
const unicodeEscape = '\u0041\u00e9';
const codePointEscape = '\u{1F600}';
const surrogatePair = '\uD83D\uDE00';
const lineContinuation = 'a \
continued line';
const empty = '';
const unicodeIdentifierValue = 'café — naïve — 日本語';

// --- templates ------------------------------------------------------------------------

const name = 'world';
const noSubstitution = `just text`;
const oneSubstitution = `hello ${name}`;
const expressionSubstitution = `sum ${1 + 2 * 3}`;
const nestedTemplate = `outer ${`inner ${name}`}`;
const multiline = `line one
line two`;
const escapeInTemplate = `backtick: \` dollar: \${not a substitution}`;
const callInSubstitution = `upper ${name.toUpperCase()}`;

// --- regular expressions -------------------------------------------------------------
//
// A regex literal is ambiguous with division and the parser must already know
// which it is from context. Both appear below, adjacent.

const simple = /abc/;
const withFlags = /abc/gimsuy;
const escapedSlash = /a\/b/;
const characterClass = /[a-z0-9_\-]+/i;
const namedGroups = /(?<year>\d{4})-(?<month>\d{2})/u;
const lookahead = /foo(?=bar)/;
const lookbehind = /(?<=\$)\d+/;
const backreference = /(\w)\1/;
const unicodeProperty = /\p{Letter}+/u;
const divisionNotRegex = maxSafe / decimal / 2;

// --- the keyword and identifier literals -------------------------------------------------

const t = true;
const f = false;
const nul = null;
const undef = undefined;              // an IDENTIFIER, not a literal
const voidUndefined = void 0;          // the un-shadowable spelling

// --- object literals -----------------------------------------------------------------------

const key = 'computed';
const shorthandValue = 1;
const objectLiteral = {
  plain: 1,
  'quoted key': 2,
  "double quoted key": 3,
  42: 'numeric key',
  0.5: 'float key',
  [key]: 'computed key',
  [`${key}-template`]: 'computed from a template',
  shorthandValue,
  method() { return this.plain; },
  *generator() { yield 1; },
  async asyncMethod() { return 1; },
  get accessor() { return this.plain; },
  set accessor(v) { this.plain = v; },
  ['computed' + 'Method']() { return 'computed method'; },
  [Symbol.iterator]() { return [][Symbol.iterator](); },
  nested: { deep: { deeper: true } },
  __proto__: null,                     // the one key that is not a property
  trailing: 'comma follows',
};

const spreadInObject = { ...objectLiteral, extra: true };
const emptyObject = {};

// --- array literals ----------------------------------------------------------------------

const arrayLiteral = [1, 'two', null, undefined, true, { a: 1 }, [2]];
const holes = [1, , 3];                // a HOLE, not undefined: `1 in holes` is false
const trailingComma = [1, 2, 3, ];
const spreadInArray = [...arrayLiteral, ...'abc'];
const emptyArray = [];
const nestedArrays = [[1, [2, [3]]]];

module.exports = {
  decimal, negative, float, leadingDot, trailingDot, exponent, negExponent,
  hex, hexUpper, octal, binary, separators, floatSeparators, zero, negativeZero,
  infinity, notANumber, maxSafe, beyondSafe, big, bigHex, bigZero,
  single, double, withApostrophe, escaped, hexEscape, unicodeEscape,
  codePointEscape, surrogatePair, lineContinuation, empty, unicodeIdentifierValue,
  noSubstitution, oneSubstitution, expressionSubstitution, nestedTemplate,
  multiline, escapeInTemplate, callInSubstitution,
  simple, withFlags, escapedSlash, characterClass, namedGroups, lookahead,
  lookbehind, backreference, unicodeProperty, divisionNotRegex,
  t, f, nul, undef, voidUndefined,
  objectLiteral, spreadInObject, emptyObject,
  arrayLiteral, holes, trailingComma, spreadInArray, emptyArray, nestedArrays
};
