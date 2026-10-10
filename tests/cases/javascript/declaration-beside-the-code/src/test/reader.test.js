const kit = require('../');
test('readAll', () => {
  const reader = new kit.Reader();
  expect(() => reader.readAll(['x'])).not.toThrow();
});
