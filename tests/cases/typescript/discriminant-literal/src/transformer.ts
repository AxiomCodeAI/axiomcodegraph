import { freeze, RawNode } from './ast'

// rebuilds a LiteralNode and never writes the interface's name
export function transformLiteral(node: { fragments: ReadonlyArray<string> }) {
  return accept(freeze({ kind: 'LiteralNode' as const, fragments: node.fragments }))
}

// CONTROL: only compares the discriminant, builds nothing
export function isLiteral(node: { kind: string }): boolean {
  return node.kind === 'LiteralNode'
}

// CONTROL: builds the other member of the family
export function makeRaw(sql: string): RawNode {
  return { kind: 'RawNode', sql }
}

function accept(n: unknown): unknown { return n }
