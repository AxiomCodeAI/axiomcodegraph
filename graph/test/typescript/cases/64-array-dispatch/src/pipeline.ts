import { widenRange, narrowRange, squareRange, type Node } from './steps'

// Four dispatch shapes over the same four functions. Three of them do not resolve,
// and the three are pinned in expected/64-array-dispatch.known-missing. Only the last
// one, and each step's own onward call to measure, are controls.

// ── 1. iterated ─────────────────────────────────────────────────────────────
// The registration is a REFERENCE, not a call. The invocation names an ELEMENT, not a
// declaration. Nothing joins runIterated to widenRange, and every declaration
// widenRange reaches inherits that silence.
const steps = [widenRange]

export function runIterated(node: Node): Node {
  for (const step of steps) node = step(node)
  return node
}

// ── 2. indexed ──────────────────────────────────────────────────────────────
// Also unresolved. The TypeScript engine has no COMPUTED_CALL clause and no
// elem_value at all; that rule lives only in the JavaScript engine. The golden also
// records this site as a METHOD_CALL, so the classification would have to move with
// the rule.
export function runIndexed(node: Node): Node {
  return steps[0](node)
}

// ── 3. keyed by a name both ends write ──────────────────────────────────────
// Also unresolved, which narrows the boundary proposed on the issue: a key surviving
// into the dispatch site is not on its own enough.
const byName = { square: squareRange }

export function runByName(node: Node): Node {
  return byName.square(node)
}

// ── 4. THE CONTROL: called by name ──────────────────────────────────────────
export function runDirect(node: Node): Node {
  return narrowRange(node)
}
