export const MAX_ITEMS = 5;
export const TIER_NAME = 'gold';
export const ENABLED = true;

export function pick(n: number): number {
  return Math.min(n, MAX_ITEMS);
}

export const RETRY_LIMIT = pick(3);
