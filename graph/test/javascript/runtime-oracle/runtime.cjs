// =============================================================================
// The tracer runtime. Loaded once per process/worker; owns globalThis.__ax.
//
// WHAT IT RECORDS
//   (site -> decl, count)  a call site, and the declaration that actually ran
//   (null -> decl, count)  a declaration entered with no site attributable to it:
//                          invoked by the host or by library code (a callback
//                          reached through setTimeout, a generator resumed later,
//                          a getter). Counted, never silently dropped.
//
// WHY A SHADOW STACK AND NOT A WRAPPER
// Wrapping the callee (`__ax(site, f)(a)`) loses `this` on a method call and
// cannot carry `await`/`yield` across the wrapper's function boundary. Wrapping
// the SITE in a comma expression leaves the call expression itself untouched, so
// receiver binding, optional chaining, spread and argument evaluation order are
// exactly what they were:
//
//     f(a)   ->   __ax.e(__ax.s(SITE), f(a))
//
// `s` pushes a marker and returns its depth; the call runs; `e` truncates the
// stack back to that depth and returns the call's value unchanged.
//
// THE ONE SUBTLE PART: WHICH MARKER A CALLEE MAY CONSUME
// A marker is consumed by the next `enter` only if no OTHER instrumented
// function has been entered since the marker was pushed or last refreshed.
// Without that test a marker left behind by a throwing call is picked up by
// whatever runs next and fabricates an edge. With it:
//
//   f(g())    push Mf, push Mg; g enters (consumes Mg); g's body may enter
//             anything; `e` for g's site truncates to Mf AND REFRESHES Mf's
//             counter, so f's enter still consumes Mf. Correct.
//   f() throws before entering anything
//             no `e` runs, so Mf leaks; but the next enter sees a counter that
//             has moved on and records `unlinked` instead of inventing an edge.
//
// WHAT IT STILL CANNOT SEE, BY CONSTRUCTION
// `arr.map(cb)` pushes a marker, `map` is library code and never enters, then it
// invokes `cb` — whose enter consumes the map site's marker. The pair recorded is
// (map-site -> cb), not (map-site -> Array.map). That is not a bug to be fixed at
// runtime: nothing here can see inside an uninstrumented frame. It is resolved at
// JOIN time instead, from a table the instrumenter writes: every function
// expression passed as an argument at a site is recorded as that site's callback,
// so the pair is classified `callback` rather than scored as a disagreement.
// =============================================================================
'use strict'
const fs = require('fs')
const path = require('path')

const OUT = process.env.AX_TRACE_OUT
if (!OUT) throw new Error('AX_TRACE_OUT is not set: the tracer has nowhere to write')

const markers = [] // {site, ec}
let enterCount = 0
const pairs = new Map() // "site\tdecl" -> count
const unlinked = new Map() // decl -> count

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

const ax = {
  // push a marker for SITE; returns its 1-based depth, handed straight to `e`
  s(site) {
    markers.push({site: site, ec: enterCount})
    return markers.length
  },
  // the call at depth `d` has returned with value `v`: drop its marker and any
  // marker leaked above it, then refresh the marker now on top so that an
  // enclosing site whose arguments contained this call can still be matched.
  e(d, v) {
    if (markers.length >= d) markers.length = d - 1
    if (markers.length) markers[markers.length - 1].ec = enterCount
    return v
  },
  // A declaration whose body starts running at a moment that is NOT a call at a
  // site: a getter or setter (invoked by a property access) and a generator body
  // (invoked by the first `.next()`, long after the call that made the object).
  // Both were observed consuming the marker of whatever site happened to be open
  // -- `say('x' + o.getter)` recorded the getter as the target of `say`, and
  // `[...gen()].join(',')` recorded the generator as the target of `join`. They
  // are counted as entries and never consume a marker.
  aux(decl) {
    bump(unlinked, decl)
    enterCount++
  },
  // a declaration is executing
  enter(decl) {
    const t = markers.length ? markers[markers.length - 1] : null
    if (t && t.ec === enterCount) {
      markers.pop()
      bump(pairs, t.site + '\t' + decl)
    } else {
      bump(unlinked, decl)
    }
    enterCount++
  },
}

// One tracer per process, even if several instrumented module graphs load it.
if (!globalThis.__ax) globalThis.__ax = ax

// ── flushing ────────────────────────────────────────────────────────────────
// Vitest runs test files in workers; each worker is its own process or thread and
// gets its own file, merged later. `exit` is not guaranteed under a worker
// teardown, so flush on several signals and make flushing idempotent.
const file = path.join(
  OUT,
  'trace-' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.tsv',
)
let flushed = false
function flush() {
  if (flushed) return
  flushed = true
  if (!pairs.size && !unlinked.size) return
  try {
    fs.mkdirSync(OUT, {recursive: true})
    const out = []
    for (const [k, n] of pairs) out.push('pair\t' + k + '\t' + n)
    for (const [d, n] of unlinked) out.push('unlinked\t\t' + d + '\t' + n)
    fs.writeFileSync(file, out.join('\n') + '\n')
  } catch (e) {
    try {
      process._rawDebug('AX_TRACE flush failed: ' + e.message)
    } catch (_) {}
  }
}
process.on('exit', flush)
process.on('beforeExit', flush)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, function () {
    flush()
    process.exit(1)
  })
}
if (globalThis.__ax === ax) globalThis.__axFlush = flush

module.exports = ax
