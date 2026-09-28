import { receipt } from './cart';

it('prints a receipt', () => {
  expect(receipt([1, 2])).toBe('paid 3');
});
