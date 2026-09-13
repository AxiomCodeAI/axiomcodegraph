// fixture: verified/object-literal-members/object-literal-members.js
// nature: runtime-bearing
// VERIFIED REPRO — object-literal method and accessor members.
//
// Verified against js-impl@1b99d0d (pushed) and re-verified against b9e2676.
// Source only; no expected facts.
//
// THE CONTROLS COME FIRST, because without them this file proves nothing. In the
// same object literal, `fnExpr: function (x) {...}` and `arrow: (x) => ...` are
// walked correctly and their calls are emitted. So are the class method, the
// static method and the class getter below. The walker works.
//
// WHAT IS LOST: every member written in MEMBER SYNTAX rather than as a property
// holding a function — shorthand method, get, set, async shorthand, generator
// shorthand, computed-name shorthand, and a shorthand one object deeper. No
// js_method row for the member, and no call site for anything inside it.
//
// §6 of BUILDING-A-PARSER.md: a tree rooted at a non-emitting node dies before
// its children are enqueued. This is the largest instance of it in JavaScript —
// 3,210 of the 3,264 call-site recall misses the compiler adjudication found over
// 4,529 files, 98.3% of them, and the top five packages hit are the platform runtime's
// library, a UI framework, an application framework, an application server and a compiler.
//
// Note `X.prototype = { m() {} }` DOES work (declarationForm
// PROTOTYPE_OBJECT_LITERAL, 15 rows corpus-wide), so the machinery for object
// literal members exists on one path and not the general one.
//
// module system: ESM, governed by object-literal-members/package.json.

import {helper} from './h.js';

// CONTROL — a top-level call, must be seen.
helper('control');

const o = {
  shorthand(x) { return helper('shorthand'); },
  fnExpr: function (x) { return helper('fnExpr'); },
  arrow: (x) => helper('arrow'),
  get g() { return helper('getter'); },
  set s(v) { helper('setter'); },
  async asyncShorthand(x) { return helper('asyncShorthand'); },
  *genShorthand(x) { yield helper('genShorthand'); },
  ['computed'](x) { return helper('computed'); },
  nested: { inner(x) { return helper('nestedInner'); } },
};

class K {
  m() { return helper('classMethod'); }
  static sm() { return helper('classStatic'); }
  get cg() { return helper('classGetter'); }
}

export default o;
