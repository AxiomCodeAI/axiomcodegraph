# The torture project — the engine three ways

`project/` is a hand-written JavaScript program (197 lines, 8 files) built to exercise
every way the language invokes a function: ES classes with `super`, statics, accessors
and `this.constructor`; pre-ES6 constructor functions with `util.inherits`,
`Object.create` and an `Object.assign` mixin; closures, currying, composition, IIFEs,
named-expression recursion, default/rest/destructured parameters; an `EventEmitter`
subclass with `on`/`once`/`emit`, computed event names and a hand-rolled dispatcher;
promises, `async`/`await`, timers, `nextTick`, a promisified callback; registries,
bracket access with literal and computed keys, `Proxy`, `Reflect.apply`, tagged
templates; and a module graph with `module.exports = function` carrying properties,
re-exports and an `exports.x` written after `module.exports` was reassigned (which is
NOT exported — the program asserts it).

`run.sh` solves it and scores the graph against two independent oracles:

1. **The compiler**, per site (`../ground-truth/tsc-oracle.mjs`) — the declared target.
2. **Execution**, per function→function edge. `instrument.mjs` rewrites every function
   body to record `(caller, callee)` at entry, with the caller carried in an
   `AsyncLocalStorage` so a promise continuation, a timer callback or an event handler
   attributes to the function that registered it — which is what the engine's
   `callback_registered` / `event_dispatch` edges claim. Platform frames are transparent.
   `score_runtime.py` then checks every executed edge is in `method_call_edge`.

The two disagree on purpose in one place: for `this.area()` in a base-class method the
compiler names the base declaration while execution names the subclass override the
receiver actually was. The engine reports both (a `multi_inferred` set over the
constructed subclasses), so it is a SOUND_SUPERSET to the compiler and FOUND at runtime.

`known-missing.txt` lists the executed edges the engine cannot have, each with its
reason; a new miss fails the run and a listed one that starts resolving fails too.
