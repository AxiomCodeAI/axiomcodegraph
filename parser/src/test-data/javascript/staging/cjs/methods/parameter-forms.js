// fixture: cjs/methods/parameter-forms.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (object rest in a parameter pattern)
//
// Port of java/methods/MethodParamsTest.java. Every js_method_parameter
// bindingForm: IDENTIFIER, OBJECT_PATTERN, ARRAY_PATTERN, ASSIGNMENT_PATTERN.
//
// The schema's ruling worth pinning here: a destructured parameter is ONE
// parameter row with patternBindingCount > 0, PLUS N js_variable rows for the
// names it binds. Emitting N parameter rows breaks `position`; emitting one row
// with no binding information loses every name.
//
// NO ANALOGUE — Java's `final` parameters, varargs `String...` (the nearest is
// rest, and it differs: rest is a real Array, varargs is an array parameter),
// and parameter annotations. TypeScript's `this` parameter and parameter
// properties have no JavaScript spelling either; js_method_parameter.isParameterProperty
// is a parity slot that stays false, and the `this` TYPE is a JSDoc tag rather
// than a parameter.

'use strict';

// --- identifiers -----------------------------------------------------------------

function none() { return 0; }
function one(a) { return a; }
function many(a, b, c, d, e) { return [a, b, c, d, e]; }
function trailingComma(a, b,) { return a + b; }

// --- defaults ------------------------------------------------------------------------

function defaults(a = 1, b = 'two', c = null, d = {}, e = []) { return [a, b, c, d, e]; }

// A default referring to an EARLIER parameter. The parameter list is a scope,
// evaluated left to right, so this is legal and the reverse is a TDZ error.
function dependentDefaults(a, b = a + 1, c = a + b) { return c; }

// A default that is a CALL. It runs once per invocation that omits the argument,
// and it is a call site inside a parameter list.
function callDefault(logger = console.log, id = Math.random()) { return [logger, id]; }

// A default that references a module-level binding, and one that references the
// function itself.
const FALLBACK = 'fallback';
function outerDefault(a = FALLBACK, b = outerDefault) { return [a, b]; }

// A non-simple parameter list makes the function body strict-only for the
// purpose of 'use strict' directives — a directive inside such a function is a
// syntax error. That is why this file is strict at the top instead.

// --- rest ----------------------------------------------------------------------------

function rest(...args) { return args; }
function leadingThenRest(first, ...others) { return [first, others]; }
function restOfPatterns(...[a, b]) { return a + b; }        // rest of an array pattern

// --- object patterns --------------------------------------------------------------------

function objectPattern({ a, b }) { return a + b; }
function objectRenamed({ a: first, b: second }) { return first + second; }
function objectDefaults({ a = 1, b = 2 } = {}) { return a + b; }
function objectNested({ a: { b: { c } } }) { return c; }
function objectRest({ a, ...others }) { return [a, others]; }
function objectComputed({ ['a' + '']: computed }) { return computed; }
function objectMixed({ a, b: renamed = 2, ...others }, plain) { return [a, renamed, others, plain]; }

// --- array patterns ------------------------------------------------------------------------

function arrayPattern([a, b]) { return a + b; }
function arrayHoles([, second]) { return second; }
function arrayDefaults([a = 1, b = 2] = []) { return a + b; }
function arrayNested([[a], [b]]) { return a + b; }
function arrayRest([head, ...tail]) { return [head, tail]; }
function mixedPatterns([a, { b }], { c: [d] }) { return a + b + d; }

// --- every callable kind takes the same parameter forms ------------------------------------------

const arrowPatterns = ({ a }, [b], c = 1, ...rest2) => [a, b, c, rest2];
const asyncArrowPatterns = async ({ a } = {}) => a;

class WithParameters {
  constructor({ host, port = 80 } = {}, ...extras) {
    this.host = host;
    this.port = port;
    this.extras = extras;
  }
  method([first], { second }, third = 3) { return [first, second, third]; }
  set value([a, b]) { this._value = a + b; }        // a setter's single parameter
  static factory({ host } = {}) { return new WithParameters({ host }); }
}

const objectLiteralMethod = {
  method({ a } = {}, [b] = [], ...rest3) { return [a, b, rest3]; }
};

function* generatorParameters(a = 1, { b } = {}) { yield a + b; }
async function asyncParameters(a, ...rest4) { return [a, rest4]; }

// --- arity vs the real argument count -------------------------------------------------------------
//
// `Function.length` counts parameters BEFORE the first default or rest, so it
// disagrees with parameterCount for most of the functions above. Both numbers
// are real and they answer different questions.

const arities = [
  many.length,                  // 5
  defaults.length,              // 0
  leadingThenRest.length,       // 1
  objectMixed.length            // 2
];

// A function that ignores its parameters entirely and reads `arguments`.
function ignoresParameters(a, b) {
  return arguments.length;      // may be more or fewer than 2
}

module.exports = {
  none, one, many, trailingComma, defaults, dependentDefaults, callDefault,
  outerDefault, rest, leadingThenRest, restOfPatterns,
  objectPattern, objectRenamed, objectDefaults, objectNested, objectRest,
  objectComputed, objectMixed,
  arrayPattern, arrayHoles, arrayDefaults, arrayNested, arrayRest, mixedPatterns,
  arrowPatterns, asyncArrowPatterns, WithParameters, objectLiteralMethod,
  generatorParameters, asyncParameters, arities, ignoresParameters
};
