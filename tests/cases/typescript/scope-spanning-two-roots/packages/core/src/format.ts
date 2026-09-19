export function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
