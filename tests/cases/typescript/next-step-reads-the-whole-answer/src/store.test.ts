import { Store } from './store';

test('counts', () => {
    expect(new Store().counted()).toBe(3);
});
