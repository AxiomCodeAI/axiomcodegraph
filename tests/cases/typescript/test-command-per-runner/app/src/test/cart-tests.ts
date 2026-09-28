/**
 * CART TESTS — a script suite, not collected by vitest.
 *
 *     npx tsx src/test/cart-tests.ts
 */
import { total } from '../cart';

function testTotalSums(): void {
  if (total([2, 2]) !== 4) throw new Error('total');
}

testTotalSums();
