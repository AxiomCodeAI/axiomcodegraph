export class Node {
  outerHtml(): string { return ''; }
}

export function fromUnknown(o: unknown): string {
  if (o instanceof Node) return o.outerHtml();
  return '';
}

export function guardedEarly(o: unknown): string {
  if (!(o instanceof Node)) return '';
  return o.outerHtml();
}

export function fromObject(o: object): string {
  if (o instanceof Node) return o.outerHtml();
  return '';
}

export function fromAny(o: any): string {
  if (o instanceof Node) return o.outerHtml();
  return '';
}

export function fromVariable(read: () => unknown): string {
  const v: unknown = read();
  if (v instanceof Node) return v.outerHtml();
  return '';
}

export function fromUnion(o: Node | string): string {
  if (o instanceof Node) return o.outerHtml();
  return o;
}

export function fromNullable(o: Node | null): string {
  if (o instanceof Node) return o.outerHtml();
  return '';
}
