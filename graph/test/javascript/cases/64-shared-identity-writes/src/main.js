// A write through a string is not a store (#732). A string is one identity per TEXT,
// so a write through one binding holding 'k' landed on every other expression holding
// 'k'; at runtime a property written onto a primitive is dropped.
function alpha() { return 'a'; }
function beta() { return 'b'; }

const key = 'k';
key.fn = beta;
function viaString() { return 'k'.fn(); }        // nothing: a string has no such member
/** @param {string} s */
function tagString(s) { s.fn = alpha; }
tagString('k');
function viaStringParam() { return 'k'.fn(); }   // nothing either

// A JSDoc typedef is one identity for every value documented with it, so a DATA store
// through it wrote into every other value of that typedef. The objects that really
// flow in keep the store; the typedef does not.
class Left { go() { return 'l'; } }
class Right { go() { return 'r'; } }
/**
 * @typedef {Object} Entry
 * @property {string} name
 */
/** @param {Entry} e */
function putLeft(e) { e.side = new Left(); }
/** @param {Entry} e */
function putRight(e) { e.side = new Right(); }
/** @param {Entry} e */
function goEntry(e) { return e.side.go(); }      // Left.go only: what THIS caller's object holds
const first = { name: 'first' };
putLeft(first);
function viaTypedef() { return goEntry(first); }
const second = { name: 'second' };
putRight(second);

// CONTROL: where the object behind a typedef is not tracked, the typedef is the only
// carrier of a handler stored on it, so a FUNCTION written through it still reads back.
/**
 * @typedef {Object} Hooks
 * @property {string} name
 */
/** @param {Hooks} hooks */
function install(hooks) { hooks.onError = alpha; }
/** @param {Hooks} hooks */
function report(hooks) { return hooks.onError(); } // alpha, through the typedef

// The controls. An object literal and a class instance keep their writes, and a
// typedef's DECLARED members still read.
class Widget { render() { return 'w'; } }
/**
 * @typedef {Object} Ctx
 * @property {Widget} widget
 */
/** @param {Ctx} c */
function draw(c) { return c.widget.render(); }  // Widget.render, from the declaration
const holder = {};
holder.run = alpha;
function viaLiteral() { return holder.run(); }   // alpha
class Box { constructor() { this.run = beta; } }
function viaInstance() { return new Box().run(); } // beta
module.exports = { viaString, viaStringParam, viaTypedef, install, report, draw, viaLiteral, viaInstance };
