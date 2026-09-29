import { OrderStore } from './orders';
import { Ledger } from './ledger';

export const ORDER_PLACED = 'order.placed';

export class Report {
  constructor(private readonly store: OrderStore) {}
  line(id: string): string {
    return this.store.get(id);
  }
}

export class Memo {
  private readonly seen = new Map<string, string>();
  recall(key: string): string | undefined {
    return this.seen.get(key);
  }
}

export function viaAny(box: any, id: string): string {
  return box.get(id);
}

export function sum(ledger: Ledger): number {
  return ledger.total(3);
}
