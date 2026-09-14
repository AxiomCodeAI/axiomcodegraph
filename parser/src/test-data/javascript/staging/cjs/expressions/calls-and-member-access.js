// fixture: cjs/expressions/calls-and-member-access.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (private `#x in obj` brand check is the only line above
//   ES2020; see MANIFEST.md's syntax-floor table)
//
// Port of java/expressions/ObjectCreationTestCases.java, MethodReferenceExamples.java
// and QualifiedConstructorTest.java. The base call vocabulary: METHOD_CALL,
// FUNCTION_CALL, CONSTRUCTOR_CALL, SUPER_CALL, IIFE_CALL. The forms syntax
// cannot decide live in cjs/call-forms/, one fixture each.
//
// NO ANALOGUE — Java method references (`String::length`). There is no `::` and
// js_method.methodReferenceKind is a parity slot that stays "". The real
// JavaScript analogue is passing the function VALUE, which is also where
// receiver binding goes wrong in practice, so that is what is covered.
//
// NO ANALOGUE — Java's qualified constructor invocation (`outer.new Inner()`)
// and `this(...)` constructor delegation. JavaScript classes do not nest as
// types and there is no `this()` form; `super()` is the only delegation.

'use strict';

const util = require('util');

function free(a, b) { return a + b; }

const receiver = {
  name: 'receiver',
  method(x) { return this.name + x; },
  nested: { deep(x) { return x; } },
  fns: [free]
};

class Base {
  constructor(v) { this.v = v; }
  render() { return 'base:' + this.v; }
  static create(v) { return new Base(v); }
}

class Derived extends Base {
  #secret = 1;                      // [ES2022] private field
  constructor(v) {
    super(v);                       // SUPER_CALL
    this.extra = true;
  }
  render() {
    return super.render() + '+derived';   // super.method(): a method call whose
                                          // receiver is `this` and whose lookup
                                          // starts at the SUPERCLASS prototype
  }
  reveal() { return this.#secret; }
  static has(obj) { return #secret in obj; }   // [ES2022] brand check
}

// --- plain calls ---------------------------------------------------------------------

const functionCall = free(1, 2);
const methodCall = receiver.method('!');
const staticCall = Base.create(1);
const chained = receiver.nested.deep('x');
const throughIndex = receiver.fns[0](1, 2);
const parenthesisedCallee = (free)(1, 2);
const commaCallee = (0, receiver.method)('!');    // detaches the receiver
const spreadArgs = free(...[1, 2]);
const trailingComma = free(1, 2,);
const noArgs = Base.create();

// A call whose callee is a call.
function makeAdder(n) { return (x) => x + n; }
const curriedCall = makeAdder(1)(2);

// A call inside every edgeRole: argument, condition, element, property value,
// template substitution, return, spread operand.
const inArgument = free(free(1, 2), 3);
const inCondition = free(1, 2) > 0 ? 'y' : 'n';
const inElement = [free(1, 2)];
const inPropertyValue = { v: free(1, 2) };
const inTemplate = `${free(1, 2)}`;
const inSpread = [...[free(1, 2)]];
function inReturn() { return free(1, 2); }

// A call nested inside PARENTHESES and inside a logical operator — the exact
// shape that vanished in TypeScript when a subtree rooted at a non-emitting node
// died before its children were enqueued (55,683 -> 57,491 expressions when
// fixed).
const inParens = ( receiver.name && receiver.method('!') );
const doubleParens = ((free(1, 2)));

// --- construction ----------------------------------------------------------------------

const constructed = new Base(1);
const noParens = new Base;                        // no argument list at all
const derived = new Derived(2);
const viaVariable = new (Base)(3);
const ofClassExpression = new (class { constructor() { this.anon = true; } })();
const nsCtor = new util.TextEncoder();            // qualified constructor
const nested = new Base(new Base(1).v);
const spreadNew = new Base(...[1]);
const builtin = new Map([[1, 'a']]);
const reflected = Reflect.construct(Base, [4]);

// --- member access ---------------------------------------------------------------------

const dotted = receiver.name;
const bracketed = receiver['name'];
const computedMember = receiver['na' + 'me'];
const numericMember = receiver.fns[0];
const deepChain = receiver.nested.deep;
const optionalMember = receiver?.nested?.deep;
const optionalComputed = receiver?.['nested']?.['deep'];
const optionalCall = receiver.nested?.deep?.('x');

// Assignment to a member — the target side of the same syntax.
receiver.added = 1;
receiver['computed added'] = 2;
receiver.nested.deeper = 3;

// A member access on a call result, on a literal, and on a template.
const onCall = Base.create(1).render();
const onLiteral = (5).toFixed(2);
const onArrayLiteral = [1, 2, 3].map(String);
const onTemplate = `abc`.toUpperCase();
const onRegex = /a/.test('a');

// --- passing functions as values: the method-reference analogue ---------------------------
//
// Java's `String::length` has no syntax here. These are the four forms real code
// uses, and the receiver-binding difference between them is the reason the Java
// construct does not port cleanly.

const asValue = free;                                  // a free function: safe
const boundMethod = receiver.method.bind(receiver);    // explicitly bound: safe
const detachedMethod = receiver.method;                // loses `this`: the bug
const wrapped = (x) => receiver.method(x);             // preserves it lexically
const mapped = [1, 2].map(free);
const mappedDetached = ['a'].map(receiver.method);     // `this` is undefined
const mappedWithThisArg = ['a'].map(receiver.method, receiver);

// A static method passed as a value, and a constructor passed as a value —
// the latter cannot be called without `new`, so passing it is usually a bug.
const staticAsValue = Base.create;
const ctorAsValue = Base;

module.exports = {
  Base, Derived,
  functionCall, methodCall, staticCall, chained, throughIndex,
  parenthesisedCallee, commaCallee, spreadArgs, trailingComma, noArgs,
  curriedCall, inArgument, inCondition, inElement, inPropertyValue, inTemplate,
  inSpread, inReturn, inParens, doubleParens,
  constructed, noParens, derived, viaVariable, ofClassExpression, nsCtor,
  nested, spreadNew, builtin, reflected,
  dotted, bracketed, computedMember, numericMember, deepChain,
  optionalMember, optionalComputed, optionalCall,
  onCall, onLiteral, onArrayLiteral, onTemplate, onRegex,
  asValue, boundMethod, detachedMethod, wrapped, mapped, mappedDetached,
  mappedWithThisArg, staticAsValue, ctorAsValue
};
