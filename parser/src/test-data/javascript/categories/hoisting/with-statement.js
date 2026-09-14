// fixture: cjs/hoisting/with-statement.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES3 — and it is a SYNTAX ERROR in strict mode and in every ES
//   module, so this file deliberately has no 'use strict' and could not be one.
//
// `with` pushes an OBJECT onto the scope chain, so every free name inside its
// body may resolve to a property of that object — and which names those are is
// decided at runtime by the object's own properties, including inherited ones.
// Every identifier in a with-body is therefore STATICALLY UNRESOLVABLE.
//
// js_scope has a WITH scope kind and a hasWithStatement flag, and
// js_parse_gap.gapKind = WITH_STATEMENT_SCOPE, precisely so the honest answer is
// recorded rather than confident wrong bindings emitted. This fixture exists to
// prove the parser marks the scope instead of resolving through it.
//
// Rare, and not extinct: `with` survives in template engines (several compile
// user templates into a with-block), which is the
// realistic provenance.

const context = { name: 'ctx', value: 1 };
const outerName = 'module scope';
let value = 99;

function render(data) {
  const out = [];
  with (data) {
    // `title` and `body` MIGHT be properties of `data`, or they might be free
    // names resolving outward. Nothing in this file can say which.
    out.push(title);
    out.push(body);
    // `out` might ALSO be a property of `data` — a name that is obviously local
    // to a reader is not obviously local to the language.
    out.push(outerName);
  }
  return out.join('');
}

function shadowing() {
  with (context) {
    // `value` here is context.value (1), not the module-level let (99) — unless
    // `context` stops having a `value` property, in which case it is the let.
    return value;
  }
}

// The inherited-property case. `toString` is not an own property of `context`
// and `with` still finds it, so even enumerating the object's own keys does not
// bound the set of names it captures.
function inherited() {
  with (context) {
    return toString();
  }
}

// A `with` whose subject is computed. The object is not knowable at all.
function dynamicSubject(key) {
  const table = { a: { x: 1 }, b: { x: 2 } };
  with (table[key]) {
    return x;
  }
}

// A function DECLARED inside a with-body. Its closure includes the with-scope,
// so the unresolvability escapes the block.
function escapes(data) {
  with (data) {
    return function () { return leaked; };
  }
}

// Nested with. Two objects on the chain, innermost first.
function nested(a, b) {
  with (a) {
    with (b) {
      return both;
    }
  }
}

module.exports = { render, shadowing, inherited, dynamicSubject, escapes, nested };
