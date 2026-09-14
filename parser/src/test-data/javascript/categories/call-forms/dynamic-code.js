// fixture: cjs/call-forms/dynamic-code.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// callKind = DYNAMIC_CODE_CALL, isDynamicCode = true. The target is UNKNOWABLE
// and the schema's rule is that it is emitted and never guessed — the call site
// is complete precisely BECAUSE it says the target cannot be named
// (resolutionOutcome = DYNAMIC_CODE in the IR-completeness gate's fourth bucket).
//
// Two sites in the whole schema corpus, which is exactly why a fixture is
// needed: an enum value that no corpus exercises cannot be told apart from an
// unimplemented one.
//
// The distinction that matters and is easy to miss: DIRECT eval sees the calling
// scope and can create bindings in it; INDIRECT eval (any call to eval that is
// not the bare identifier `eval`) runs in global scope and cannot. Two
// expressions that differ only in punctuation, with different scope effects.
//
// Grounded in the JSON-parsing fallbacks of old libraries, the template
// compilers that build functions from strings (every JS template engine), and
// the `new Function('return this')()` globalThis shim.

'use strict';

const outerBinding = 'visible to direct eval';

// --- direct eval: sees and can WRITE the local scope --------------------------------

function directEval() {
  const local = 1;
  // Reads a local. The string is data; the binding it reads is real.
  const read = eval('local + 1');
  // Creates a binding in THIS scope. In sloppy mode `var injected` would be
  // visible after this line; in strict mode eval gets its own scope, so it is
  // not. Same call, two scope structures, decided by the directive.
  eval('var injected = 42;');
  return [read, typeof injected];
}

// A direct eval whose argument is not a literal. Nothing about the code it runs
// is in this file.
function evalVariable(source) {
  return eval(source);
}

// --- indirect eval: global scope only -------------------------------------------------
//
// Each of these is the SAME function and a different semantics.

const geval = eval;
function indirectEval() {
  const local = 'not visible';
  const viaAlias = geval('typeof local');            // 'undefined'
  const viaComma = (0, eval)('typeof local');        // 'undefined'
  const viaMember = globalThis.eval('typeof local'); // 'undefined'
  const viaOptional = eval?.('typeof local');        // 'undefined' — indirect
  return [viaAlias, viaComma, viaMember, viaOptional];
}

// --- new Function: always global scope, never the caller's -----------------------------
//
// The parameters and body are STRINGS, so the function's arity and its entire
// contents are runtime values. A js_method row for the produced function cannot
// exist: there is no declaration node.

const add = new Function('a', 'b', 'return a + b;');
const sum = add(1, 2);

// Called without `new` — identical behaviour, and the call kind differs.
const mul = Function('a', 'b', 'return a * b;');

// The globalThis shim, which is why `new Function` survives in libraries that
// would otherwise never use it.
const getGlobal = new Function('return this')();

// A body assembled from data. Every JS template engine
// compile to exactly this.
function compile(template) {
  const body = 'return `' + template.replace(/`/g, '\\`') + '`;';
  return new Function('data', 'with (data) { ' + body + ' }');
}
const rendered = compile('hello ${name}')({ name: 'world' });

// --- the timer forms that take a string -------------------------------------------------
//
// setTimeout with a STRING argument evaluates it as code, in global scope. The
// callee is setTimeout; the code that runs is in the argument.

const timer = setTimeout('globalThis.__timerRan = true', 0);
clearTimeout(timer);

// The control: the same function with a FUNCTION argument. Not dynamic code.
const properTimer = setTimeout(() => { globalThis.__timerRan = true; }, 0);
clearTimeout(properTimer);

// --- eval-adjacent things that are NOT dynamic code ---------------------------------------
//
// The controls. Each parses data rather than code, and a matcher keyed on
// "builds a value from a string" would sweep all of them in.

const parsed = JSON.parse('{"a":1}');
const asNumber = Number('42');
const asRegExp = new RegExp('^a' + 'b$', 'i');       // a pattern, not code
const tagged = String.raw`no\escape`;

// A local variable named `eval` — legal in sloppy mode, and it is not eval.
function shadowedEval() {
  const evalLike = { call: () => 'not eval' };
  return evalLike.call();
}

module.exports = {
  outerBinding, directEval, evalVariable, indirectEval,
  add, sum, mul, getGlobal, compile, rendered,
  parsed, asNumber, asRegExp, tagged, shadowedEval
};
