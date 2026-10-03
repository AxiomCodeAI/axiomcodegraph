import { total, Tokens, OrderShape } from './config';
test('total', () => { expect(total()).toBe(1001); expect(Tokens.Clock).toBe('Clock'); expect(OrderShape.id).toBe('string'); });
