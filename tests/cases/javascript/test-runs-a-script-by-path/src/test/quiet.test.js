const { quiet } = require('../lib/quiet');

test('quiet lowers', () => {
  expect(quiet('A')).toBe('a');
});
