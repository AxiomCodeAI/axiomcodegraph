// fixture: cjs/prototypes/constructor-function.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5
//
// A type declared without the word `class`. typeCategory = CONSTRUCTOR_FUNCTION,
// declarationForm = PROTOTYPE_CONSTRUCTOR. Nothing in the syntax distinguishes
// this function from any other; what makes it a type is that it is CALLED WITH
// `new` and that properties are hung on its `.prototype`. Both pieces of
// evidence are elsewhere in the file, which is the whole difficulty.
//
// Grounded in a runtime's pre-class EventEmitter, a web framework's router, and
// every pre-`class` library.

'use strict';

/**
 * A route.
 *
 * @param {string} path the path pattern
 * @constructor
 */
function Handler(path) {
  // `this.x = ...` inside a constructor function is a FIELD declaration —
  // declarationForm = CONSTRUCTOR_THIS_ASSIGNMENT. The field's owner is the
  // enclosing constructor's type, and there is no syntax saying so.
  this.path = path;
  this.steps = [];
  this.verbs = Object.create(null);

  // A conditional field. Whether `this.name` exists depends on the argument, so
  // the type has a member that may not be there.
  if (path) {
    this.name = path.replace(/\W+/g, '_');
  }

  // A method assigned per instance rather than on the prototype. Each `new`
  // makes a new function object; it is a member all the same.
  this.toString = function () {
    return 'Handler(' + this.path + ')';
  };

  // The forgotten-new guard. If called without `new`, `this` is the module's
  // exports in sloppy mode and undefined in strict, so real libraries recover
  // by calling themselves properly. This is a CONSTRUCTOR_CALL whose callee is
  // the enclosing function, from inside that function.
  if (!(this instanceof Handler)) {
    return new Handler(path);
  }
}

// The prototype methods live in their own fixture; one here, so this file's
// type has at least one non-constructor member.
Handler.prototype.dispatch = function dispatch(req, res, next) {
  return next();
};

// A constructor function with no prototype members at all. It is still a type
// as soon as anything calls it with `new`, and nothing in its declaration says
// so — the only evidence is the `new Segment(...)` at the bottom of this file.
function Segment(pattern, handler) {
  this.pattern = pattern;
  this.handler = handler;
}

// A constructor function assigned to a variable rather than declared. The
// type's name comes from the binding, and the function expression is anonymous.
var Query = function (params) {
  this.params = params || {};
};

// Named function expression: TWO names. `Params` is visible only inside the
// function body; `NamedQuery` is the binding. A type keyed on the wrong one is
// keyed on a name nothing outside can use.
var NamedQuery = function Params(raw) {
  this.raw = raw;
  this.self = Params;
};

// A factory that returns an object literal — NOT a constructor function, and
// NOT a type. Object literals are values. A parser that mints a type per object
// literal acquires tens of thousands of meaningless ones, which is why the
// schema excludes them; this is the control that proves the exclusion holds.
function makeOptions(overrides) {
  return Object.assign({ strict: false, depth: 1 }, overrides);
}

// Instantiation. `new` is the evidence that turns the functions above into
// types, and it is a call site (callKind = CONSTRUCTOR_CALL) in its own right.
var home = new Handler('/');
var layer = new Segment(/^\/users/, home.dispatch);
var query = new Query({ page: 1 });
var named = new NamedQuery('a=1');

// `new` with no argument list. Same call kind, argumentCount 0, and the parens
// are absent from the syntax entirely.
var bare = new Handler;

// `new` through a variable holding the constructor. The callee is not a
// declaration name, and which type is constructed is a runtime fact.
var Ctor = process.env.FIXTURE_LAYER ? Segment : Handler;
var dynamic = new Ctor('/dynamic');

// `new` on a member expression.
var ns = { Handler: Handler };
var viaMember = new ns.Handler('/via');

// Reflect.construct — `new` spelled as a function call. Same effect, no `new`
// token anywhere, so a syntactic matcher for NewExpression misses it.
var reflected = Reflect.construct(Handler, ['/reflected']);

module.exports = {
  Handler: Handler,
  Segment: Segment,
  Query: Query,
  NamedQuery: NamedQuery,
  makeOptions: makeOptions,
  instances: [home, layer, query, named, bare, dynamic, viaMember, reflected]
};
