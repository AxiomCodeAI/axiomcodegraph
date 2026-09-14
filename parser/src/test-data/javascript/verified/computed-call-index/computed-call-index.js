// fixture: verified/computed-call-index/computed-call-index.js
// nature: runtime-bearing
// VERIFIED REPRO — the index expression of a computed CALL.
//
// Verified against js-impl@1b99d0d (pushed) and re-verified against b9e2676.
// Source only; no expected facts.
//
// FIVE OF THE SEVEN POSITIONS IN THIS FILE ARE CONTROLS, and they are the point.
// A computed member READ, a computed ASSIGNMENT TARGET, a computed property name
// in an object literal and a computed member name on a class all walk their index
// expression and emit the calls inside it.
//
// The call position alone does not. `db[pick(ARGS)](1)` emits the COMPUTED_CALL
// row and loses `pick(ARGS)`; `db[Array.isArray(ARGS) ? 'a' : 'b'](2)` loses
// `Array.isArray(ARGS)`.
//
// 54 sites corpus-wide, so small — and structural out of proportion to that,
// because the lost call is usually the PREDICATE that decides which method is
// invoked. An application server writes `db[Array.isArray(set) ? 'sortedSetsAdd' : 'sortedSetAdd'](...)`
// and a media-player library writes `fn[Array.isArray(args) ? 'apply' : 'call'](...)`. An engine
// keeps the call and loses the discriminator.
//
// module system: ESM, governed by computed-call-index/package.json.

import {pick, ARGS} from './h.js';

// CONTROL — the index expression at statement level, must be seen.
const k = pick(ARGS);

const db = {};
// 1. computed CALL whose index expression contains a call
db[pick(ARGS)](1);
// 2. ternary index, the arity-dispatch spelling
db[Array.isArray(ARGS) ? 'a' : 'b'](2);
// 3. computed member READ (not a call) whose index contains a call
const v = db[pick(ARGS)];
// 4. computed property NAME in an object literal
const o = { [Symbol.for(pick(ARGS))]: 1 };
// 5. computed method NAME in an object literal
const o2 = { [Symbol.for(pick(ARGS))]() { return 1; } };
// 6. computed member on a class
class C { [Symbol.for(pick(ARGS))]() { return 1; } }
// 7. computed ASSIGNMENT target
db[pick(ARGS)] = 3;

export default [k, v, o, o2, C];
