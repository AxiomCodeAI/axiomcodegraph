const path = require('path');
const { spawnSync } = require('child_process');

test('the stamp script prefixes the epoch', () => {
  const r = spawnSync('node', [path.resolve(__dirname, '../bin/stamp.js'), 'x']);
  expect(r.stdout.toString()).toContain('1970');
});
