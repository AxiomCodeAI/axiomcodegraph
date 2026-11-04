export function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

export function truncate(text: string, limit = 80): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + "...";
}

export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}
