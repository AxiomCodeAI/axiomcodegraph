const fs = require('fs');
const path = require('path');

test('the cli source has a shebang', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  expect(text.startsWith('#!')).toBe(true);
});
