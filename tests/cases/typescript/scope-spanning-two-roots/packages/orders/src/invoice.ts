import { formatAmount } from '../../core/src/format';

export function subtotalLabel(cents: number): string {
  return 'Subtotal: ' + formatAmount(cents);
}

export function totalLabel(cents: number): string {
  return 'Total: ' + formatAmount(cents);
}
