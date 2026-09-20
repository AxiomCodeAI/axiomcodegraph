export type Node = { width: number }

/** Reached only through the array, by iteration and by index. Never named at a call. */
export function widenRange(node: Node): Node {
  return { ...node, width: measure(node) }
}

/** The control: called by name, which is the shape that never needed a rule. */
export function narrowRange(node: Node): Node {
  return { ...node, width: measure(node) - 1 }
}

/** Reached only through the object literal, under a key both ends write. */
export function squareRange(node: Node): Node {
  return { ...node, width: measure(node) * 2 }
}

/** The far end of every chain. Each step above reaches it, and each of those resolves. */
export function measure(node: Node): number {
  return node.width + 1
}
