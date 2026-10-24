export const MAX_ITEMS = 5;
export const API_URL = "https://example.invalid/api";
export const CONFIG = { timeout: 30, retries: 3 };

export function pick(n: number): number {
  return Math.min(n, MAX_ITEMS);
}

export const RETRY_LIMIT = pick(3);

export class Pager {
  static PAGE_SIZE = 50;
  static MAX_ITEMS = 100;

  fetch(): number {
    const batch = 10;
    return batch * Pager.PAGE_SIZE;
  }
}
