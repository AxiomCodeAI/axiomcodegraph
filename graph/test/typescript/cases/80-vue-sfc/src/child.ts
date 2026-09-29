export function Child(props: { msg: string }): string {
  return props.msg;
}

export function MyBadge(): string {
  return 'badge';
}

export function format(n: number): string {
  return n.toFixed(2);
}
