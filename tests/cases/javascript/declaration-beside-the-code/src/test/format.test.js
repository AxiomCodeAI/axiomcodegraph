const { wrap } = require('../lib/format.js');
test('wrap', () => { expect(wrap('a')).toBe('[a]'); });
