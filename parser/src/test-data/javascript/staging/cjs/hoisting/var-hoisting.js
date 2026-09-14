// fixture: cjs/hoisting/var-hoisting.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (let/const appear only as contrast)
//
// The two scope columns. js_variable carries BOTH declarationScopeLinkHash (where
// the name is visible from) and syntacticScopeLinkHash (the block the declaration
// is written in), and for `var` they differ whenever the declaration sits inside
// a block. That difference IS hoisting, and it is not recoverable from anything
// else in the fact base — an engine would have to re-implement JavaScript's
// scoping rules to derive one from the other.
//
// The scope-coherence gate reads this file: every VAR_* binding's declaration
// scope must have isFunctionScope = true.
//
// 3,705 `var` bindings in the schema's corpus. Not a legacy curiosity.

'use strict';

// Declared inside a block, visible for the whole module scope.
{
  var blockDeclared = 'visible outside the block';
}
const stillVisible = blockDeclared;

// Read BEFORE the declaration line. Not an error: the binding exists from the
// start of the scope and holds undefined until the assignment runs. This is the
// difference from a TDZ, and the two must not be modelled with one flag.
const beforeDeclaration = typeof laterVar;   // 'undefined', not a ReferenceError
var laterVar = 'assigned on line 30';

function functionScoped() {
  // Same name declared twice in one function. Legal, one binding, and the
  // second `var` is not a redeclaration error the way a second `let` would be.
  var dup = 1;
  var dup = 2;

  if (true) {
    var inIf = 'hoists to functionScoped';
  }
  for (var i = 0; i < 3; i += 1) {
    var inLoop = i;
  }
  try {
    var inTry = 'hoists too';
  } catch (e) {
    var inCatch = e;
  }
  switch (dup) {
    case 2: {
      var inCase = 'and here';
      break;
    }
  }
  // Every one of these is visible here, and none of them was declared here.
  return [dup, inIf, i, inLoop, inTry, inCatch, inCase];
}

// A `var` in a nested function does NOT escape it. The nearest function scope is
// the boundary, and `outer` cannot see `inner`.
function outer() {
  var outerVar = 'outer';
  function inner() {
    var innerVar = 'inner';
    return outerVar + innerVar;
  }
  // typeof is the only safe probe: `innerVar` is not in scope at all here.
  return [inner(), typeof innerVar];
}

// A `var` shadowing a parameter of the same name. One binding, not two.
function shadowsParameter(value) {
  var value = value || 'default';
  return value;
}

// A `var` whose declaration is unreachable. The BINDING still exists, hoisted,
// holding undefined — the declaration hoists even though the assignment never
// runs. This is the clearest case where syntactic position and binding effect
// come apart.
function unreachableDeclaration() {
  return 'early';
  var neverAssigned = 'never runs';
}

// `var` in a for-in / for-of head. The binding is function-scoped, so it
// survives the loop and holds the LAST value.
function loopHeads(obj) {
  for (var key in obj) { /* body */ }
  for (var item of Object.values(obj)) { /* body */ }
  return [key, item];
}

// The contrast, in the same file so the pair is comparable: `let` in a block is
// invisible outside it, and its two scope columns are equal.
{
  let letInBlock = 'invisible outside';
  var varBesideIt = letInBlock;
}
const onlyVarEscaped = typeof varBesideIt;

// `var` at module top level in CommonJS is NOT a global. The module wrapper is a
// function, so the module scope IS a function scope — which is why
// js_scope.isFunctionScope is true for MODULE. In a script (or an ES module,
// for a different reason) the same line behaves differently.
var notAGlobal = true;

module.exports = {
  blockDeclared, stillVisible, beforeDeclaration, laterVar,
  functionScoped, outer, shadowsParameter, unreachableDeclaration,
  loopHeads, onlyVarEscaped, notAGlobal
};
