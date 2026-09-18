import { widenRange, type Node } from './steps'

// The registration is a REFERENCE, not a call; the invocation names an element, not a declaration.
// Between them, nothing in the graph joins `run` to `widenRange`.
const steps = [widenRange]

export function run(node: Node): Node {
  for (const step of steps) node = step(node)
  return node
}
