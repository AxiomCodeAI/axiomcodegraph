// fixture: cjs/call-forms/generators-and-iterators.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (async iteration)
//
// GENERATOR_RESUME, reserved with a zero-row assertion. `it.next()` is
// syntactically an ordinary method call and semantically a RESUMPTION of a
// suspended frame: control re-enters the generator body in the middle, at the
// `yield` it last stopped at. Which yield that is depends on how many times
// `next` has been called before, so no static answer exists.
//
// The declarations are ordinary and must be emitted — isGenerator on js_method,
// 248 yield sites in the schema's corpus. It is only the resumption edge that is
// unreadable.
//
// `for...of` is the same thing with the calls implicit: it invokes
// [Symbol.iterator](), then next() repeatedly, then possibly return(), and none
// of those appears in the source.

'use strict';

// --- declarations --------------------------------------------------------------

function* counter(from, to) {
  for (let i = from; i <= to; i += 1) {
    // The value SENT IN by next(v) is the result of this expression. Data flows
    // backwards through a yield, which no call-graph edge models.
    const sent = yield i;
    if (sent === 'stop') { return 'stopped'; }
  }
  return 'done';
}

// yield* delegates: the inner generator's yields pass through, and its return
// value becomes the value of the yield* expression. One call site, N resumptions
// of a DIFFERENT function.
function* delegating() {
  const inner = yield* counter(1, 3);
  yield inner;
}

// A generator method, a static generator, and a generator on a prototype.
class Tree {
  constructor(value, children) { this.value = value; this.children = children || []; }
  *walk() {
    yield this.value;
    for (const child of this.children) { yield* child.walk(); }
  }
  static *range(n) { for (let i = 0; i < n; i += 1) { yield i; } }
  [Symbol.iterator]() { return this.walk(); }
}

function Legacy() {}
Legacy.prototype.items = function* () { yield 1; };

// An async generator, and its async iterator protocol.
async function* streamed(items) {
  for (const item of items) {
    yield await Promise.resolve(item);
  }
}

// --- explicit resumption ---------------------------------------------------------
//
// Each of these re-enters a suspended body. `next`, `return` and `throw` are the
// three entry points, and `throw` injects an exception AT the yield.

const it = counter(1, 3);
const a = it.next();          // runs to the first yield
const b = it.next();          // resumes AFTER that yield
const c = it.next('stop');    // resumes and delivers a value into the body
const d = it.return('early'); // resumes as if a return statement were at the yield
const e = counter(1, 3);
e.next();
let thrown;
try { e.throw(new Error('injected')); } catch (err) { thrown = err.message; }

// --- implicit resumption -----------------------------------------------------------
//
// No `.next()` anywhere. for-of does all of it.

const collected = [];
for (const n of counter(1, 3)) { collected.push(n); }

// Destructuring from an iterable: calls next() exactly as many times as there
// are targets, then return().
const [firstItem, secondItem] = counter(10, 20);

// Spread: calls next() until done.
const spread = [...counter(1, 4)];

// Array.from, and a Map/Set built from an iterable.
const fromIterable = Array.from(counter(1, 3));
const asSet = new Set(counter(1, 3));

// yield inside a for-of over another generator, two levels deep.
const tree = new Tree('root', [new Tree('a'), new Tree('b', [new Tree('c')])]);
const walked = [...tree];

// --- a hand-written iterator: the protocol without a generator -----------------------
//
// Same for-of, same next() calls, and no generator function anywhere. The
// resumption is now an ordinary call to an ordinary method, which is why the
// distinction cannot be drawn from the call site.

const manual = {
  [Symbol.iterator]() {
    let i = 0;
    return {
      next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
      return() { return { done: true }; }
    };
  }
};
const manualCollected = [...manual];

// --- async iteration -------------------------------------------------------------------

async function consume() {
  const out = [];
  for await (const item of streamed([1, 2, 3])) { out.push(item); }
  const ai = streamed([1]);
  const next = await ai.next();
  return { out, next };
}

module.exports = {
  counter, delegating, Tree, Legacy, streamed,
  a, b, c, d, thrown, collected, firstItem, secondItem, spread,
  fromIterable, asSet, walked, manual, manualCollected, consume
};
