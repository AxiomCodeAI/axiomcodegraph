// fixture: cjs/hoisting/arrow-lexical-this.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The other half of this-by-call-form.js. An arrow does not BIND `this` at all —
// it has no `this` of its own, so the name resolves up the scope chain exactly
// as any other free variable would. js_scope.bindsThis is false for ARROW, and
// that one boolean is the whole mechanism: lexical `this` is not a special rule,
// it is the absence of a binding.
//
// The same is true of `arguments`, `super` and `new.target`. bindsArguments is
// false for ARROW for the same reason.
//
// 9,391 arrows in the schema's corpus, many sharing a line, which is why
// startColumn is in js_method's primary key.

'use strict';

class Timer {
  constructor(name) {
    this.name = name;
    this.ticks = 0;
  }

  // An arrow inside a method: `this` is the method's `this`, which is the
  // instance. This is the form that made the `var self = this` idiom obsolete.
  startWorking() {
    return [1, 2, 3].map(() => {
      this.ticks += 1;
      return this.name;
    });
  }

  // A plain function in the same position: `this` is undefined (strict), and
  // the two lines are otherwise identical.
  startBroken() {
    return [1, 2, 3].map(function () {
      return this && this.name;
    });
  }

  // An arrow stored as an instance property in the constructor is bound per
  // INSTANCE and survives detachment — the View event-handler idiom. It is
  // also a member declared by assignment, not a class method.
  install() {
    this.handler = () => this.name;
    return this.handler;
  }

  // Nested arrows: three levels, one `this`, resolved at the outermost
  // non-arrow function boundary.
  deep() {
    return () => () => () => this.name;
  }
}

// An arrow at MODULE level. `this` is module.exports in CommonJS and undefined
// in an ES module, so the arrow's meaning depends on a file it does not contain.
const moduleArrow = () => this;

// An arrow as an object-literal property. The enclosing OBJECT is not a scope,
// so `this` is the module's, NOT the object's — the single most common arrow
// mistake, and the shorthand method beside it does the expected thing.
const config = {
  name: 'config',
  arrow: () => this,
  method() { return this; },
  nestedArrowInMethod() { return (() => this)(); }
};

// .call / .apply / .bind CANNOT change an arrow's `this`. The receiver argument
// is accepted and ignored, which means a bind-based fix silently does nothing.
const arrowThis = () => this;
const unchanged = arrowThis.call({ name: 'ignored' });
const stillUnchanged = arrowThis.bind({ name: 'ignored' })();

// An arrow has no `arguments` of its own — it sees the enclosing function's.
function outerWithArguments() {
  const inner = () => arguments.length;
  return inner(1, 2, 3);        // the OUTER call's argument count
}

// An arrow cannot be called with `new`: it has no [[Construct]] and no
// .prototype. `new arrowThis()` is a TypeError, which is a difference between
// the two callable kinds with no syntactic marker.
const arrowHasPrototype = 'prototype' in arrowThis;    // false

// Concise body vs block body. bodyPresence = EXPRESSION_BODY vs HAS_BODY, and
// the concise form has an implicit return that the block form does not.
const concise = (x) => x * 2;
const block = (x) => { return x * 2; };
const conciseObject = (x) => ({ value: x });   // parens, or the brace is a block

// Every parameter form on an arrow, including the one with no parens.
const noParens = x => x;
const noParams = () => 'nothing';
const defaulted = (x = 1, y = x + 1) => x + y;
const rest = (...args) => args.length;
const destructured = ({ a, b: renamed = 2 }, [first]) => a + renamed + first;
const asyncArrow = async (x) => x;

// An arrow returning an arrow, on one line — two js_method rows with the same
// startLine and different startColumn.
const curried = (a) => (b) => a + b;

module.exports = {
  Timer, moduleArrow, config, arrowThis, unchanged, stillUnchanged,
  outerWithArguments, arrowHasPrototype, concise, block, conciseObject,
  noParens, noParams, defaulted, rest, destructured, asyncArrow, curried
};
