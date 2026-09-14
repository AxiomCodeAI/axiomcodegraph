// fixture: cjs/hoisting/sloppy-implicit-global.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// NOTE: this file has NO 'use strict' directive, on purpose. CommonJS is sloppy
// unless a directive says otherwise, and js_scope.isStrictMode /
// strictModeSource = SLOPPY are what record that. Adding the directive would
// turn every assignment below into a TypeError, so the absence is load-bearing
// and must not be "fixed".
//
// bindingRegime = GLOBAL_IMPLICIT is the binding with NO DECLARATION. An
// assignment to an undeclared name in sloppy mode creates a property on the
// global object; in strict mode it throws ReferenceError. The same source line
// is a binding in one file and an error in another, which is exactly why the
// scope tree cannot be derived from declarations alone.

// --- the implicit global ------------------------------------------------------

// No var, no let, no const. This creates globalThis.implicitCounter, visible to
// every other module in the process.
implicitCounter = 0;

function bump() {
  // Assigned inside a function, still global. The binding's scope is not the
  // function it appears in, and nothing at this line says so.
  implicitCounter = implicitCounter + 1;
  alsoGlobal = 'created on first call';
  return implicitCounter;
}

// The classic typo: a chained declaration where only the first name is declared.
// `second` and `third` are implicit globals.
var first = 1, second = 2;
function chainedAssignment() {
  var a = b = c = 5;      // only `a` is local; `b` and `c` are globals
  return [a, b, c];
}

// Reading an undeclared name is a ReferenceError in BOTH modes — only writing
// differs. typeof is the exception that does not throw.
const safeProbe = typeof neverAssigned;

// --- Annex B block-level function declarations ----------------------------------
//
// In sloppy mode a function declared in a block ALSO creates a function-scoped
// var of the same name, hoisted and initialised when the block runs. In strict
// mode it is block-scoped only. Same source, two binding structures, decided by
// a directive that is not on this line.

function annexB() {
  const before = typeof blockFn;    // 'undefined' — the var exists, unassigned
  {
    function blockFn() { return 'annex B'; }
  }
  const after = typeof blockFn;     // 'function' — visible outside the block
  return [before, after];
}

// --- arguments aliasing --------------------------------------------------------
//
// In sloppy mode a non-simple-free parameter list makes `arguments` a LIVE
// ALIAS of the named parameters: writing arguments[0] writes the parameter, and
// vice versa. Strict mode severs the link. usesArguments records that the
// second parameter channel is in play; the aliasing is why it matters.

function aliased(x) {
  arguments[0] = 'changed';
  return x;                          // 'changed' in sloppy mode, original in strict
}

// --- octal literals and other sloppy-only syntax ---------------------------------
//
// A legacy octal literal is a syntax error under 'use strict'. Parsing this file
// as strict fails outright, which makes the module system and directive a
// PARSE-time input, not only a semantic one.

const legacyOctal = 0755;
const octalEscape = '\101';

// --- delete on an unqualified name ------------------------------------------------
//
// Legal in sloppy mode, a syntax error in strict mode. Deleting an implicit
// global works; deleting a declared var does not.

implicitCounter = 1;
const deletedImplicit = delete implicitCounter;   // true
const deletedDeclared = delete first;             // false

// --- a function whose body is strict while the file is not -------------------------
//
// The directive is per-scope. This function and everything nested in it is
// strict; the rest of the file is not. strictModeSource = USE_STRICT_DIRECTIVE
// on this scope, SLOPPY on the module's.

function strictIsland() {
  'use strict';
  try {
    undeclaredInStrict = 1;    // ReferenceError here, an implicit global two lines up
  } catch (e) {
    return e.constructor.name;
  }
  return null;
}

// --- a class body is strict even here ------------------------------------------------
//
// strictModeSource = CLASS_BODY_IMPLICIT. No directive, no module system,
// strict anyway.

class AlwaysStrict {
  attempt() {
    try {
      undeclaredInClass = 1;
      return null;
    } catch (e) {
      return e.constructor.name;
    }
  }
}

module.exports = {
  bump, chainedAssignment, safeProbe, annexB, aliased,
  legacyOctal, octalEscape, deletedImplicit, deletedDeclared,
  strictIsland, AlwaysStrict
};
