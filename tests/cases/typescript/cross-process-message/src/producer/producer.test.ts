import { it, expect } from 'vitest';
import { ItemPublisher } from './producer';

it('announces an item', () => {
  const publisher = new ItemPublisher({ emit: () => 1, send: () => 1 } as never);
  expect(publisher.announce('a')).toBeDefined();
});
