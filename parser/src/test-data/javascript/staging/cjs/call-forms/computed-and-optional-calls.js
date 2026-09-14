// fixture: cjs/call-forms/computed-and-optional-calls.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2020 (optional chaining, nullish coalescing)
//
// Two call kinds syntax cannot fully decide.
//
// COMPUTED_CALL (663 sites measured): `obj[expr]()`. calleeName is "" because
// there is no name in the syntax to put there, and inventing one — say, by
// constant-folding the expression when it happens to be a literal — is a
// resolution decision, not a parse. isComputedName says the name is not fixed.
//
// OPTIONAL_CALL (28 sites): `a?.b()`. Differs in REACHABILITY, not in target.
// The target is exactly the target of `a.b()`; whether the call happens is a
// runtime fact about `a`.
//
// INDEX_CALL is the reserved value nearby, and it is reserved because whether a
// computed access goes THROUGH AN INDEX SIGNATURE is a fact about the receiver's
// type. Nothing in this file can tell a parser that, which is the point.
//
// Grounded in a web framework's `methods.forEach(function(method){ app[method] = ... })`,
// a utility library's `_[name]` dispatch, and every options-object handler table.

'use strict';

const handlers = {
  get(path) { return 'GET ' + path; },
  post(path) { return 'POST ' + path; },
  'delete'(path) { return 'DELETE ' + path; }
};

// --- computed calls -------------------------------------------------------------

// A string literal in brackets. Syntax DOES fix this name — it is the control
// that stops a parser from calling everything in brackets unnameable.
const literalKey = handlers['get']('/a');

// A variable. The name is not knowable.
const method = process.env.FIXTURE_METHOD || 'post';
const viaVariable = handlers[method]('/b');

// An expression. Two operands and a concatenation.
const viaExpression = handlers['de' + 'lete']('/c');

// A member expression as the key.
const config = { verb: 'get' };
const viaMember = handlers[config.verb]('/d');

// The dispatch-table loop. One call site in the source, N targets at runtime,
// and the set of targets is the object's keys.
const results = [];
for (const name of Object.keys(handlers)) {
  results.push(handlers[name]('/loop'));
}

// A numeric index into an array of functions. Same construct; the "name" is an
// integer and the receiver is an Array.
const pipeline = [(x) => x + 1, (x) => x * 2];
const piped = pipeline[0](pipeline[1](3));

// A symbol key. Not a string at all, and not printable as a name.
const TAG = Symbol('tag');
const symbolKeyed = { [TAG]: () => 'symbol call' };
const viaSymbol = symbolKeyed[TAG]();

// A computed call whose receiver is itself computed.
const registry = { handlers };
const nestedComputed = registry['handlers'][method]('/nested');

// A computed access that is READ, not called. The control for the call kind.
const readOnly = handlers[method];

// --- optional calls -----------------------------------------------------------------

const maybe = process.env.FIXTURE_NULL ? null : handlers;

// Optional member, then a call. The `?.` guards the MEMBER ACCESS; if `maybe`
// is null the whole chain short-circuits and `get` is never looked up.
const optionalMember = maybe?.get('/e');

// Optional CALL: guards the invocation. `maybe.get` is looked up; if it is
// nullish it is not called.
const optionalCall = maybe?.get?.('/f');

// Optional computed call — both forms at once.
const optionalComputed = maybe?.[method]?.('/g');

// A long chain where the short-circuit skips everything downstream, including
// argument evaluation. The argument's side effect does not happen.
let sideEffectRan = false;
const deep = maybe?.missing?.deeper?.(sideEffectRan = true);

// Optional call on a function-valued variable.
const callback = null;
const optionalCallback = callback?.();

// `?.` followed by a NON-optional link. Only the first link is guarded; the
// rest throw if the chain is broken past it. This is the common misuse.
const partiallyGuarded = maybe?.get('/h');

// Nullish coalescing beside it, which is a different operator with a different
// short circuit: `??` tests the VALUE, `?.` tests the RECEIVER.
const withDefault = maybe?.get?.('/i') ?? 'default';

// Optional call in a tagged-template position is a SYNTAX ERROR, and optional
// `new` is too. Recorded rather than written: `new a?.b()` and ``a?.b`x` `` do
// not parse, so no fixture can contain them.

module.exports = {
  handlers, literalKey, viaVariable, viaExpression, viaMember, results,
  piped, viaSymbol, nestedComputed, readOnly,
  optionalMember, optionalCall, optionalComputed, deep, sideEffectRan,
  optionalCallback, partiallyGuarded, withDefault
};
