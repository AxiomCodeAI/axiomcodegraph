export interface AstNode { readonly kind: string }

export interface LiteralNode extends AstNode {
  readonly kind: 'LiteralNode'
  readonly fragments: ReadonlyArray<string>
}

export interface RawNode extends AstNode {
  readonly kind: 'RawNode'
  readonly sql: string
}

export function freeze<T>(o: T): Readonly<T> { return Object.freeze(o) }
