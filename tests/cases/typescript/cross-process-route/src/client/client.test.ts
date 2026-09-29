import { it, expect } from 'vitest';
import { placeOrder } from './client';

it('places an order', async () => {
  expect(await placeOrder({ sku: 'a' })).toBeDefined();
});
