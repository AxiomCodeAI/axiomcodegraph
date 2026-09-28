import { widen, narrow, square, halve, pushed, spreadIn, neverRun, exportedSteps, type Node } from './steps'

// Callables registered as DATA and dispatched by iteration, index or key (#967). None of
// these call sites names a declaration, so each is a value call through the collection:
// a dispatch-rung route in the envelope, not a resolved call-site edge.

const steps = [widen, narrow]
const frozen = [square] as const
const table = { grow: widen, shrink: narrow }
const registry: Array<(n: Node) => Node> = []
registry.push(pushed)
const extended = [...steps, spreadIn]
const idle = [neverRun]

// iterated
export function runIterated(node: Node): Node {
  for (const step of steps) node = step(node)
  return node
}

// iterated through `as const`
export function runFrozen(node: Node): Node {
  for (const step of frozen) node = step(node)
  return node
}

// indexed, and indexed into a local first
export function runIndexed(node: Node, i: number): Node {
  const pick = steps[i]
  return pick(steps[0](node))
}

// a table read under a computed key reaches every entry; under a written key, only that entry
export function runByKey(node: Node, k: 'grow' | 'shrink'): Node {
  return table[k](node)
}
export function runByName(node: Node): Node {
  return table.shrink(node)
}

// the element parameter of an array method's callback
export function runForEach(node: Node): void {
  steps.forEach((step) => step(node))
}
export function runReduce(node: Node): Node {
  return frozen.reduce((acc, step) => step(acc), node)
}

// filled by push, and by a spread of another registry
export function runRegistry(node: Node): Node {
  for (const step of registry) node = step(node)
  for (const step of extended) node = step(node)
  return node
}

// imported from the module that declares it
export function runImported(node: Node): Node {
  for (const step of exportedSteps) node = step(node)
  return node
}

// the values of a table
export function runValues(node: Node): Node {
  for (const step of Object.values(table)) node = step(node)
  return node
}

// CONTROL: the idle array is only measured, never run, so neverRun keeps no caller.
export function countIdle(): number {
  return idle.length
}

// CONTROL: a for-in binds KEYS, never elements, so nothing here is a call through the table.
export function keysOnly(): string[] {
  const out: string[] = []
  for (const k in table) out.push(k)
  return out
}

// CONTROL: called by name, the shape that never needed a rule.
export function runDirect(node: Node): Node {
  return halve(node)
}
