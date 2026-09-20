// The step the pipeline dispatches to. Nothing calls it by name anywhere in the program.
export function widenRange(node: Node): Node {
  return { ...node, width: measure(node) }
}

export function measure(node: Node): number {
  return node.width + 1
}

export type Node = { width: number }
