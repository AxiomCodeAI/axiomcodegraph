export type Node = { width: number }

// Each step is named at NO call site: it is reached only through the collection holding it.
export function widen(node: Node): Node { return { width: measure(node) + 1 } }
export function narrow(node: Node): Node { return { width: measure(node) - 1 } }
export function square(node: Node): Node { return { width: measure(node) * 2 } }
export function halve(node: Node): Node { return { width: measure(node) / 2 } }
export function pushed(node: Node): Node { return { width: measure(node) + 3 } }
export function spreadIn(node: Node): Node { return { width: measure(node) + 4 } }

// CONTROL: held in an array nothing ever iterates, indexes or calls through.
export function neverRun(node: Node): Node { return { width: measure(node) + 5 } }

// The far end of every chain.
export function measure(node: Node): number { return node.width }

// An exported registry, iterated from another module.
export const exportedSteps = [halve]
