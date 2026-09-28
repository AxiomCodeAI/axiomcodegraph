import { total } from './pricing';

export function checkout(items: number[]): number {
  return total(items);
}

export function receipt(items: number[]): string {
  return 'paid ' + String(checkout(items));
}
