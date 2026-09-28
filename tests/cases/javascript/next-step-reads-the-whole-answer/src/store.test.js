const { Store } = require('./store');

test('counts', () => {
    expect(new Store().counted()).toBe(3);
});
