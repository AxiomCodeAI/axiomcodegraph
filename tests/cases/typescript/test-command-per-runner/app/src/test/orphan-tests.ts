import { total } from '../cart';

function testTotalEmpty(): void {
  if (total([]) !== 0) throw new Error('empty');
}

testTotalEmpty();
