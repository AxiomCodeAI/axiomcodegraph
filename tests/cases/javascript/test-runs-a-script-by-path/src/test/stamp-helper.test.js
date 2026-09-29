const { spawnSync } = require('child_process');

const bin = require.resolve('../bin/stamp');
const run = (args) => spawnSync(process.execPath, [bin].concat(args)).stdout.toString();

test('the stamp script keeps its argument', () => {
  expect(run(['kept'])).toContain('kept');
});
