// fixture: cjs/prototypes/bound-members.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015, except class Switch's field initialiser (ES2022), which
//   is there only as the LEXICAL contrast to the BOUND cases
//
// A member whose value is the RESULT OF .bind(). js_method.thisBinding has four
// values — LEXICAL, DYNAMIC, BOUND, NONE — and BOUND had no fixture: every
// `.bind` in this corpus produced a local, never a declared member, so the value
// carried zero rows and could not be told apart from an unimplemented one.
//
// The distinction is real and not cosmetic. A DYNAMIC method loses its receiver
// when detached; a BOUND one does not. That is the entire reason the pattern
// exists, and it is why `this.handleClick = this.handleClick.bind(this)` was in
// the constructor of every View class component for five years.
//
// Grounded in that idiom, in a runtime's internal streams (`this._read = this._read.bind(this)`),
// and in the `autobind` helper every pre-hooks codebase had.

'use strict';

const EventEmitter = require('events').EventEmitter;

// --- the constructor rebinding idiom -------------------------------------------
//
// `this.handle` shadows the prototype method with a bound copy. Two members with
// one name: one on the prototype (DYNAMIC), one per instance (BOUND). Which one
// a call reaches depends on the receiver, and both are declared.

function Button(label) {
  EventEmitter.call(this);
  this.label = label;
  this.handleClick = this.handleClick.bind(this);
  this.handleKey = Button.prototype.handleKey.bind(this);
}

Button.prototype.handleClick = function handleClick(event) {
  return this.label + ':' + event;
};
Button.prototype.handleKey = function handleKey(code) {
  return this.label + '#' + code;
};

// --- a prototype member installed as an already-bound function -------------------
//
// The declaration site IS the bind. There is no unbound version of this member
// anywhere, so the receiver is fixed for every instance — which for a prototype
// member means every instance shares one receiver, and that is almost always a
// bug. The fixture states the shape; whether it is a bug is not the parser's call.

const shared = { name: 'shared' };
Button.prototype.describeShared = function describe() {
  return this.name;
}.bind(shared);

// --- a static bound to the constructor -------------------------------------------

Button.create = function create(label) {
  return new this(label);
}.bind(Button);

// --- partial application at the declaration site ------------------------------------
//
// bind fixes the receiver AND leading arguments, so the declared member's arity
// is smaller than the function's. parameterCount and the callable's real arity
// disagree, and neither is wrong.

function render(prefix, suffix, body) {
  return prefix + body + suffix;
}
Button.prototype.renderTag = render.bind(null, '<', '>');

// --- a class field holding a bound method ---------------------------------------------

class Toggle extends EventEmitter {
  constructor() {
    super();
    this.on = true;
    this.flip = this.flip.bind(this);
  }
  flip() { this.on = !this.on; return this.on; }
}

// --- the arrow alternative, for contrast ------------------------------------------------
//
// Same effect, thisBinding = LEXICAL rather than BOUND, and it is not a bind at
// all. The two members below behave identically and are classified differently,
// which is the point of having both.

class Switch {
  constructor() { this.on = false; }
  flipArrow = () => { this.on = !this.on; return this.on; };
}

// --- detaching each kind, so the difference is observable ---------------------------------

const button = new Button('ok');
const detachedBound = button.handleClick;      // survives: BOUND
const detachedDynamic = Button.prototype.handleClick;  // loses `this`: DYNAMIC
const toggle = new Toggle();
const detachedField = toggle.flip;             // survives

module.exports = {
  Button, Toggle, Switch, render,
  detachedBound, detachedDynamic, detachedField
};
