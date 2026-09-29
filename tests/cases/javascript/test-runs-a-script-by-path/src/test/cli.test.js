const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

test('the cli shouts its argument', () => {
  const out = execFileSync(process.execPath, [CLI, 'hello']).toString();
  expect(out).toBe('HELLO!\n');
});
